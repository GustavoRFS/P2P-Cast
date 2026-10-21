#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <windows.h>
#include <combaseapi.h>
#include <objidl.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <ksmedia.h>
#include <propvarutil.h>

#include <fcntl.h>
#include <io.h>

#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <new>
#include <vector>

// ActivateAudioInterfaceAsync only accepts an agile handler: it must answer IAgileObject and
// offer free-threaded marshaling, otherwise the activation fails with E_ILLEGAL_METHOD_CALL.
class ActivationHandler final : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
public:
    explicit ActivationHandler(HANDLE finished) : finished_(finished) {
        CoCreateFreeThreadedMarshaler(
            static_cast<IActivateAudioInterfaceCompletionHandler*>(this), &marshaler_);
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (!result) return E_POINTER;
        if (iid == __uuidof(IUnknown) || iid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            *result = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            AddRef();
            return S_OK;
        }
        if (iid == __uuidof(IAgileObject)) {
            *result = static_cast<IAgileObject*>(this);
            AddRef();
            return S_OK;
        }
        if (iid == __uuidof(IMarshal) && marshaler_) {
            return marshaler_->QueryInterface(iid, result);
        }
        *result = nullptr;
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override { return refs_.fetch_add(1) + 1; }

    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG remaining = refs_.fetch_sub(1) - 1;
        if (remaining == 0) delete this;
        return remaining;
    }

    HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
        HRESULT activationResult = E_FAIL;
        IUnknown* activated = nullptr;
        const HRESULT result = operation->GetActivateResult(&activationResult, &activated);
        if (FAILED(result)) {
            activationResult_ = result;
        } else {
            activationResult_ = activationResult;
            activated_ = activated;
        }
        SetEvent(finished_);
        return S_OK;
    }

    HRESULT activationResult() const { return activationResult_; }
    IUnknown* activated() const { return activated_; }

private:
    ~ActivationHandler() {
        if (marshaler_) marshaler_->Release();
        if (activated_) activated_->Release();
    }

    std::atomic<ULONG> refs_{1};
    IUnknown* marshaler_ = nullptr;
    HANDLE finished_;
    HRESULT activationResult_ = E_PENDING;
    IUnknown* activated_ = nullptr;
};

static int fail(const char* message, HRESULT result = S_OK) {
    std::cerr << message;
    if (FAILED(result)) std::cerr << " (HRESULT 0x" << std::hex << static_cast<unsigned long>(result) << ")";
    std::cerr << std::endl;
    return 1;
}

static bool writeBytes(const void* bytes, size_t length) {
    std::cout.write(static_cast<const char*>(bytes), static_cast<std::streamsize>(length));
    std::cout.flush();
    return static_cast<bool>(std::cout);
}

int main(int argc, char** argv) {
    // The PCM stream must not be CRLF-translated: text mode turns every 0x0A sample byte into 0x0D 0x0A.
    _setmode(_fileno(stdout), _O_BINARY);

    if (argc != 2) return fail("Expected a desktop window handle");
    char* end = nullptr;
    const unsigned long long rawHandle = std::strtoull(argv[1], &end, 0);
    if (!end || *end != '\0' || rawHandle == 0) return fail("Invalid desktop window handle");

    const HWND window = reinterpret_cast<HWND>(static_cast<uintptr_t>(rawHandle));
    DWORD processId = 0;
    if (!IsWindow(window) || GetWindowThreadProcessId(window, &processId) == 0 || processId == 0) {
        return fail("Could not resolve the selected window to an application process");
    }

    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult)) return fail("Could not initialize COM", comResult);

    HANDLE activatedEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!activatedEvent) {
        CoUninitialize();
        return fail("Could not create the WASAPI activation event");
    }

    AUDIOCLIENT_ACTIVATION_PARAMS activationParams{};
    activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    activationParams.ProcessLoopbackParams.TargetProcessId = processId;
    activationParams.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT activationProperty;
    PropVariantInit(&activationProperty);
    activationProperty.vt = VT_BLOB;
    activationProperty.blob.cbSize = sizeof(activationParams);
    activationProperty.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

    auto* completion = new (std::nothrow) ActivationHandler(activatedEvent);
    if (!completion) {
        CloseHandle(activatedEvent);
        CoUninitialize();
        return fail("Could not allocate the WASAPI completion handler");
    }

    IAudioClient* audioClient = nullptr;
    IActivateAudioInterfaceAsyncOperation* activationOperation = nullptr;
    HRESULT result = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &activationProperty,
        completion,
        &activationOperation);
    if (FAILED(result)) {
        completion->Release();
        CloseHandle(activatedEvent);
        CoUninitialize();
        return fail("Could not request process loopback", result);
    }

    if (WaitForSingleObject(activatedEvent, 10'000) != WAIT_OBJECT_0) {
        activationOperation->Release();
        completion->Release();
        CloseHandle(activatedEvent);
        CoUninitialize();
        return fail("Timed out while opening process loopback");
    }

    result = completion->activationResult();
    if (SUCCEEDED(result) && completion->activated()) {
        result = completion->activated()->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&audioClient));
    } else if (SUCCEEDED(result)) {
        result = E_NOINTERFACE;
    }
    activationOperation->Release();
    completion->Release();
    CloseHandle(activatedEvent);
    if (FAILED(result) || !audioClient) {
        CoUninitialize();
        return fail("Could not activate process loopback", result);
    }

    WAVEFORMATEXTENSIBLE format{};
    format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
    format.Format.nChannels = 2;
    format.Format.nSamplesPerSec = 48'000;
    format.Format.wBitsPerSample = 32;
    format.Format.nBlockAlign = 8;
    format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
    format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
    format.Samples.wValidBitsPerSample = 32;
    format.dwChannelMask = KSAUDIO_SPEAKER_STEREO;
    format.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;

    HANDLE samplesReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!samplesReady) {
        audioClient->Release();
        CoUninitialize();
        return fail("Could not create the WASAPI sample event");
    }

    constexpr REFERENCE_TIME bufferDuration = 2'000'000;
    const DWORD streamFlags = AUDCLNT_STREAMFLAGS_LOOPBACK
        | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    result = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        streamFlags,
        bufferDuration,
        0,
        &format.Format,
        nullptr);
    if (SUCCEEDED(result)) result = audioClient->SetEventHandle(samplesReady);

    IAudioCaptureClient* captureClient = nullptr;
    if (SUCCEEDED(result)) result = audioClient->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&captureClient));
    if (FAILED(result)) {
        CloseHandle(samplesReady);
        audioClient->Release();
        CoUninitialize();
        return fail("Could not initialize the process audio stream", result);
    }

    std::cout << "{\"sampleRate\":48000,\"channels\":2,\"format\":\"f32le\"}\n";
    std::cout.flush();
    result = audioClient->Start();
    if (FAILED(result)) {
        captureClient->Release();
        CloseHandle(samplesReady);
        audioClient->Release();
        CoUninitialize();
        return fail("Could not start process audio capture", result);
    }

    std::vector<float> silence;
    bool running = true;
    while (running && std::cout.good()) {
        const DWORD waitResult = WaitForSingleObject(samplesReady, 1000);
        if (waitResult == WAIT_FAILED) break;
        if (waitResult == WAIT_TIMEOUT) continue;

        UINT32 packetFrames = 0;
        result = captureClient->GetNextPacketSize(&packetFrames);
        while (SUCCEEDED(result) && packetFrames > 0) {
            BYTE* packet = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            result = captureClient->GetBuffer(&packet, &frames, &flags, nullptr, nullptr);
            if (FAILED(result)) break;

            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) {
                silence.assign(static_cast<size_t>(frames) * 2, 0.0f);
                running = writeBytes(silence.data(), silence.size() * sizeof(float));
            } else {
                running = writeBytes(packet, static_cast<size_t>(frames) * format.Format.nBlockAlign);
            }

            const HRESULT releaseResult = captureClient->ReleaseBuffer(frames);
            if (FAILED(releaseResult)) {
                result = releaseResult;
                break;
            }
            result = captureClient->GetNextPacketSize(&packetFrames);
        }
        if (FAILED(result)) break;
    }

    audioClient->Stop();
    captureClient->Release();
    CloseHandle(samplesReady);
    audioClient->Release();
    CoUninitialize();
    return 0;
}
