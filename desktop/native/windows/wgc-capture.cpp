#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <windows.graphics.capture.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <windows.graphics.directx.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <fcntl.h>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <io.h>

using namespace winrt;
using namespace winrt::Windows::Graphics;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;

namespace {
constexpr uint32_t FRAME_MAGIC = 0x50434652; // "PCFR"
constexpr UINT FRAME_POOL_SIZE = 3;
constexpr uint64_t MAX_FRAME_BYTES = 256ull * 1024ull * 1024ull;

struct FrameHeader {
    uint32_t magic;
    uint32_t width;
    uint32_t height;
    uint32_t byteLength;
};

bool write_exact(const void* data, size_t length) {
    std::cout.write(static_cast<const char*>(data), static_cast<std::streamsize>(length));
    std::cout.flush();
    return std::cout.good();
}

bool parse_handle(const char* raw, uintptr_t* value) {
    if (!raw || !value || !*raw) return false;
    char* end = nullptr;
    const auto parsed = std::strtoull(raw, &end, 16);
    if (!end || *end != '\0' || parsed == 0) return false;
    *value = static_cast<uintptr_t>(parsed);
    return static_cast<unsigned long long>(*value) == parsed;
}

struct CaptureState {
    ID3D11Device* d3dDevice = nullptr;
    ID3D11DeviceContext* context = nullptr;
    ID3D11Texture2D* staging = nullptr;
    UINT stagingWidth = 0;
    UINT stagingHeight = 0;
    IDirect3DDevice captureDevice{ nullptr };
    Direct3D11CaptureFramePool framePool{ nullptr };
    SizeInt32 poolSize{};
    std::mutex frameMutex;
    std::chrono::steady_clock::time_point lastFrame{};
    std::vector<uint8_t> rgbaScratch;
    UINT fps = 30;
    HANDLE closedEvent = nullptr;
    std::atomic<bool> running{ true };
    std::atomic<bool> outputEnabled{ false };
    std::atomic<bool> frameAwaitingAck{ false };
    std::atomic<HRESULT> lastError{ S_OK };

    ~CaptureState() {
        if (closedEvent) CloseHandle(closedEvent);
        if (staging) staging->Release();
        if (context) context->Release();
        if (d3dDevice) d3dDevice->Release();
    }
};

void on_frame_arrived(const std::shared_ptr<CaptureState>& state) {
    std::lock_guard<std::mutex> lock(state->frameMutex);
    if (!state->running.load() || !state->outputEnabled.load()) return;

    auto frame = state->framePool.TryGetNextFrame();
    if (!frame) return;
    if (state->frameAwaitingAck.load(std::memory_order_acquire)) return;
    const auto contentSize = frame.ContentSize();
    if (contentSize.Width <= 0 || contentSize.Height <= 0) return;
    if (contentSize.Width != state->poolSize.Width || contentSize.Height != state->poolSize.Height) {
        frame.Close();
        state->poolSize = contentSize;
        state->framePool.Recreate(
            state->captureDevice,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            FRAME_POOL_SIZE,
            contentSize);
        return;
    }

    const auto now = std::chrono::steady_clock::now();
    const auto frameInterval = std::chrono::microseconds(1'000'000 / std::max<UINT>(1, state->fps));
    if (state->lastFrame.time_since_epoch().count() != 0 && now - state->lastFrame < frameInterval) return;
    state->lastFrame = now;

    auto surface = frame.Surface();
    auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    winrt::com_ptr<ID3D11Texture2D> source;
    const HRESULT interfaceResult = access->GetInterface(
        __uuidof(ID3D11Texture2D),
        reinterpret_cast<void**>(source.put()));
    if (FAILED(interfaceResult)) {
        state->lastError.store(interfaceResult);
        state->running.store(false);
        SetEvent(state->closedEvent);
        return;
    }

    D3D11_TEXTURE2D_DESC sourceDesc{};
    source->GetDesc(&sourceDesc);
    if (sourceDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM) {
        state->lastError.store(E_NOTIMPL);
        state->running.store(false);
        SetEvent(state->closedEvent);
        return;
    }
    D3D11_TEXTURE2D_DESC stagingDesc = sourceDesc;
    stagingDesc.Usage = D3D11_USAGE_STAGING;
    stagingDesc.BindFlags = 0;
    stagingDesc.MiscFlags = 0;
    stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    stagingDesc.ArraySize = 1;
    stagingDesc.MipLevels = 1;
    stagingDesc.SampleDesc.Count = 1;
    stagingDesc.SampleDesc.Quality = 0;

    if (state->staging && (state->stagingWidth != stagingDesc.Width || state->stagingHeight != stagingDesc.Height)) {
        state->staging->Release();
        state->staging = nullptr;
    }
    if (!state->staging) {
        const HRESULT result = state->d3dDevice->CreateTexture2D(&stagingDesc, nullptr, &state->staging);
        if (FAILED(result)) {
            state->lastError.store(result);
            state->running.store(false);
            SetEvent(state->closedEvent);
            return;
        }
        state->stagingWidth = stagingDesc.Width;
        state->stagingHeight = stagingDesc.Height;
    }
    state->context->CopyResource(state->staging, source.get());

    D3D11_MAPPED_SUBRESOURCE mapped{};
    const HRESULT result = state->context->Map(state->staging, 0, D3D11_MAP_READ, 0, &mapped);
    if (FAILED(result)) {
        state->lastError.store(result);
        state->running.store(false);
        SetEvent(state->closedEvent);
        return;
    }

    const uint32_t width = static_cast<uint32_t>(contentSize.Width);
    const uint32_t height = static_cast<uint32_t>(contentSize.Height);
    const uint64_t byteLength64 = static_cast<uint64_t>(width) * height * 4;
    if (byteLength64 > std::numeric_limits<uint32_t>::max() || byteLength64 > MAX_FRAME_BYTES) {
        state->context->Unmap(state->staging, 0);
        state->lastError.store(E_OUTOFMEMORY);
        state->running.store(false);
        SetEvent(state->closedEvent);
        return;
    }

    state->rgbaScratch.resize(static_cast<size_t>(byteLength64));
    for (uint32_t y = 0; y < height; ++y) {
        const auto* bgra = static_cast<const uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch;
        auto* row = state->rgbaScratch.data() + static_cast<size_t>(y) * width * 4;
        for (uint32_t x = 0; x < width; ++x) {
            row[x * 4 + 0] = bgra[x * 4 + 2];
            row[x * 4 + 1] = bgra[x * 4 + 1];
            row[x * 4 + 2] = bgra[x * 4 + 0];
            row[x * 4 + 3] = bgra[x * 4 + 3];
        }
    }
    state->context->Unmap(state->staging, 0);

    const FrameHeader header{ FRAME_MAGIC, width, height, static_cast<uint32_t>(state->rgbaScratch.size()) };
    if (!write_exact(&header, sizeof(header)) || !write_exact(state->rgbaScratch.data(), state->rgbaScratch.size())) {
        state->running.store(false);
        SetEvent(state->closedEvent);
        return;
    }
    state->frameAwaitingAck.store(true, std::memory_order_release);
}
}

int main(int argc, char** argv) {
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    if (argc != 5) return 2;

    uintptr_t rawHandle = 0;
    if (!parse_handle(argv[2], &rawHandle)) return 3;
    char* fpsEnd = nullptr;
    const unsigned long requestedFps = std::strtoul(argv[3], &fpsEnd, 10);
    if (!fpsEnd || *fpsEnd != '\0' || requestedFps < 1 || requestedFps > 240) return 4;
    const bool cursorEnabled = std::string(argv[4]) != "0";

    const std::string kind = argv[1];
    GraphicsCaptureItem item{ nullptr };
    try {
        init_apartment(apartment_type::multi_threaded);
        if (!GraphicsCaptureSession::IsSupported()) return 5;

        auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        if (kind == "window") {
            const HWND window = reinterpret_cast<HWND>(rawHandle);
            if (!IsWindow(window)) return 6;
            check_hresult(interop->CreateForWindow(
                window,
                guid_of<GraphicsCaptureItem>(),
                put_abi(item)));
        } else if (kind == "monitor") {
            const HMONITOR monitor = reinterpret_cast<HMONITOR>(rawHandle);
            MONITORINFOEXW info{};
            info.cbSize = sizeof(info);
            if (!GetMonitorInfoW(monitor, reinterpret_cast<MONITORINFO*>(&info))) return 7;
            check_hresult(interop->CreateForMonitor(
                monitor,
                guid_of<GraphicsCaptureItem>(),
                put_abi(item)));
        } else {
            return 8;
        }

        D3D_FEATURE_LEVEL featureLevel{};
        ID3D11Device* d3dDevice = nullptr;
        ID3D11DeviceContext* context = nullptr;
        HRESULT result = D3D11CreateDevice(
            nullptr,
            D3D_DRIVER_TYPE_HARDWARE,
            nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            nullptr,
            0,
            D3D11_SDK_VERSION,
            &d3dDevice,
            &featureLevel,
            &context);
        if (FAILED(result)) {
            result = D3D11CreateDevice(
                nullptr,
                D3D_DRIVER_TYPE_WARP,
                nullptr,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                nullptr,
                0,
                D3D11_SDK_VERSION,
                &d3dDevice,
                &featureLevel,
                &context);
        }
        if (FAILED(result)) return 9;

        winrt::com_ptr<IDXGIDevice> dxgiDevice;
        result = d3dDevice->QueryInterface(IID_PPV_ARGS(dxgiDevice.put()));
        if (FAILED(result)) {
            context->Release();
            d3dDevice->Release();
            return 10;
        }
        winrt::com_ptr<IInspectable> inspectableDevice;
        result = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.get(), inspectableDevice.put());
        if (FAILED(result)) {
            context->Release();
            d3dDevice->Release();
            return 11;
        }
        auto winrtDevice = inspectableDevice.as<IDirect3DDevice>();

        auto state = std::make_shared<CaptureState>();
        state->d3dDevice = d3dDevice;
        state->context = context;
        state->captureDevice = winrtDevice;
        state->fps = static_cast<UINT>(requestedFps);
        state->poolSize = item.Size();
        state->closedEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!state->closedEvent || state->poolSize.Width <= 0 || state->poolSize.Height <= 0) return 12;

        state->framePool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            winrtDevice,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            FRAME_POOL_SIZE,
            state->poolSize);
        auto session = state->framePool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled(cursorEnabled);
        auto closedToken = item.Closed([state](const auto&, const auto&) {
            state->running.store(false);
            SetEvent(state->closedEvent);
        });
        auto frameToken = state->framePool.FrameArrived([state](const auto&, const auto&) {
            try {
                on_frame_arrived(state);
            } catch (const hresult_error& error) {
                state->lastError.store(error.code());
                state->running.store(false);
                SetEvent(state->closedEvent);
            } catch (...) {
                state->lastError.store(E_FAIL);
                state->running.store(false);
                SetEvent(state->closedEvent);
            }
        });
        session.StartCapture();

        std::cout << "{\"width\":" << state->poolSize.Width
                  << ",\"height\":" << state->poolSize.Height
                  << ",\"format\":\"rgba8\"}\n";
        std::cout.flush();
        state->outputEnabled.store(true);
        HANDLE inputHandle = reinterpret_cast<HANDLE>(_get_osfhandle(_fileno(stdin)));
        HANDLE waitHandles[] = { state->closedEvent, inputHandle };
        while (state->running.load()) {
            const DWORD wait = WaitForMultipleObjects(2, waitHandles, FALSE, INFINITE);
            if (wait == WAIT_OBJECT_0) break;
            if (wait == WAIT_OBJECT_0 + 1) {
                char acknowledgement = 0;
                std::cin.read(&acknowledgement, 1);
                if (!std::cin || acknowledgement != 1) {
                    state->running.store(false);
                    break;
                }
                state->frameAwaitingAck.store(false, std::memory_order_release);
                continue;
            }
            const DWORD error = GetLastError();
            state->lastError.store(error == ERROR_SUCCESS ? E_FAIL : HRESULT_FROM_WIN32(error));
            state->running.store(false);
            break;
        }
        state->running.store(false);
        state->framePool.FrameArrived(frameToken);
        item.Closed(closedToken);
        session.Close();
        state->framePool.Close();
        if (FAILED(state->lastError.load())) return 13;
        return 0;
    } catch (...) {
        return 14;
    }
}
