use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    ptr::null_mut,
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, TRUE},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
            KEYEVENTF_UNICODE, VK_RETURN,
        },
        Shell::ShellExecuteW,
        WindowsAndMessaging::{
            BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowThreadProcessId,
            IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOWNORMAL,
        },
    },
};

const PORT: u16 = 43172;
const ENDPOINT: &str = "/v1/playdemo";
const HEALTH_ENDPOINT: &str = "/health";
const GC_ORIGIN: &str = "https://gamersclub.com.br";
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024;
const CONSOLE_KEY: u16 = 0xC0; // VK_OEM_3, the default CS2 console key on US-layout keyboards.
const CS2_LAUNCH_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
struct PlayDemoRequest {
    path: String,
}

struct HttpRequest {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

pub fn start() -> Result<(), String> {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => listener,
        Err(error) => {
            let message = format!("Could not bind the GC demo listener on port {PORT}: {error}");
            log::error!("{message}");
            return Err(message);
        }
    };
    if let Err(error) = thread::Builder::new()
        .name("p2p-gc-demo-listener".to_string())
        .spawn(move || {
            for incoming in listener.incoming() {
                match incoming {
                    Ok(stream) => handle_connection(stream),
                    Err(error) => log::error!("GC demo listener error: {error}"),
                }
            }
        })
    {
        let message = format!("Could not start the GC demo listener thread: {error}");
        log::error!("{message}");
        return Err(message);
    }
    log::info!("GC demo listener listening on 127.0.0.1:{PORT}");
    Ok(())
}

fn handle_connection(stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(stream);
    let request = match read_request(&mut reader) {
        Ok(request) => request,
        Err((status, message)) => {
            respond(reader.get_mut(), status, &message, false);
            return;
        }
    };

    let origin_allowed = request.headers.get("origin").map(String::as_str) == Some(GC_ORIGIN);
    let host_allowed = request.headers.get("host").map(String::as_str)
        == Some(format!("127.0.0.1:{PORT}").as_str());
    if !origin_allowed || !host_allowed {
        respond(
            reader.get_mut(),
            "403 Forbidden",
            "Origem não autorizada.",
            false,
        );
        return;
    }

    if request.target != ENDPOINT && request.target != HEALTH_ENDPOINT {
        respond(
            reader.get_mut(),
            "404 Not Found",
            "Endpoint não encontrado.",
            true,
        );
        return;
    }
    if request.method == "OPTIONS" {
        respond(reader.get_mut(), "204 No Content", "", true);
        return;
    }
    if request.method == "GET" && request.target == HEALTH_ENDPOINT {
        respond(reader.get_mut(), "200 OK", "P2P-Cast pronto.", true);
        return;
    }
    if request.target != ENDPOINT {
        respond(
            reader.get_mut(),
            "405 Method Not Allowed",
            "Use POST neste endpoint.",
            true,
        );
        return;
    }
    if request.method != "POST" {
        respond(
            reader.get_mut(),
            "405 Method Not Allowed",
            "Use POST.",
            true,
        );
        return;
    }
    if request
        .headers
        .get("content-type")
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        != Some("application/json")
    {
        respond(
            reader.get_mut(),
            "415 Unsupported Media Type",
            "Envie application/json.",
            true,
        );
        return;
    }

    let request: PlayDemoRequest = match serde_json::from_slice(&request.body) {
        Ok(request) => request,
        Err(_) => {
            log::error!("GC demo request rejected: invalid JSON body");
            respond(reader.get_mut(), "400 Bad Request", "JSON inválido.", true);
            return;
        }
    };
    match open_demo(&request.path) {
        Ok(message) => {
            log::info!("GC demo request sent to CS2");
            respond(reader.get_mut(), "200 OK", &message, true);
        }
        Err(message) => {
            log::error!("GC demo request failed: {message}");
            respond(reader.get_mut(), "400 Bad Request", &message, true);
        }
    }
}

fn read_request(
    reader: &mut BufReader<TcpStream>,
) -> Result<HttpRequest, (&'static str, &'static str)> {
    let mut consumed = 0usize;
    let request_line = read_bounded_line(reader, &mut consumed)?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or(("400 Bad Request", "Requisição inválida."))?;
    let target = request_parts
        .next()
        .ok_or(("400 Bad Request", "Requisição inválida."))?;
    let version = request_parts
        .next()
        .ok_or(("400 Bad Request", "Requisição inválida."))?;
    if request_parts.next().is_some() || version != "HTTP/1.1" {
        return Err(("400 Bad Request", "Requisição inválida."));
    }

    let mut headers = HashMap::new();
    loop {
        let line = read_bounded_line(reader, &mut consumed)?;
        if line.is_empty() {
            break;
        }
        let (name, value) = line
            .split_once(':')
            .ok_or(("400 Bad Request", "Cabeçalho inválido."))?;
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty() || headers.insert(name, value.trim().to_string()).is_some() {
            return Err(("400 Bad Request", "Cabeçalho duplicado ou inválido."));
        }
    }

    if headers.contains_key("transfer-encoding") {
        return Err(("400 Bad Request", "Transfer-Encoding não é aceito."));
    }
    let body_length = match headers.get("content-length") {
        Some(length) => length
            .parse::<usize>()
            .map_err(|_| ("400 Bad Request", "Content-Length inválido."))?,
        None if method == "OPTIONS" || method == "GET" => 0,
        None => return Err(("411 Length Required", "Content-Length é obrigatório.")),
    };
    if body_length > MAX_BODY_BYTES {
        return Err(("413 Payload Too Large", "Corpo da requisição muito grande."));
    }
    let mut body = vec![0; body_length];
    reader
        .read_exact(&mut body)
        .map_err(|_| ("400 Bad Request", "Corpo incompleto."))?;

    Ok(HttpRequest {
        method: method.to_string(),
        target: target.to_string(),
        headers,
        body,
    })
}

fn read_bounded_line(
    reader: &mut BufReader<TcpStream>,
    consumed: &mut usize,
) -> Result<String, (&'static str, &'static str)> {
    let mut bytes = Vec::new();
    let count = reader
        .read_until(b'\n', &mut bytes)
        .map_err(|_| ("400 Bad Request", "Não foi possível ler a requisição."))?;
    if count == 0 {
        return Err(("400 Bad Request", "Requisição incompleta."));
    }
    *consumed += count;
    if *consumed > MAX_HEADER_BYTES {
        return Err((
            "431 Request Header Fields Too Large",
            "Cabeçalhos muito grandes.",
        ));
    }
    String::from_utf8(bytes)
        .map(|line| {
            line.trim_end_matches(|character| character == '\r' || character == '\n')
                .to_string()
        })
        .map_err(|_| ("400 Bad Request", "Cabeçalho inválido."))
}

fn respond(stream: &mut TcpStream, status: &str, message: &str, allow_gc_origin: bool) {
    let body = if status == "204 No Content" {
        String::new()
    } else {
        serde_json::json!({ "ok": status == "200 OK", "message": message }).to_string()
    };
    let cors = if allow_gc_origin {
        format!(
            "Access-Control-Allow-Origin: {GC_ORIGIN}\r\n\
             Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
             Access-Control-Allow-Headers: Content-Type\r\n\
             Access-Control-Max-Age: 600\r\n\
             Vary: Origin\r\n"
        )
    } else {
        String::new()
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n{cors}\r\n{body}",
        body.len(),
    );
    let _ = stream.flush();
}

fn open_demo(path: &str) -> Result<String, String> {
    let path = validate_demo_path(path)?;
    let window = match find_cs2_window() {
        Some(window) => window,
        None => {
            log::info!("CS2 is not running; requesting Steam to launch app 730");
            launch_cs2_via_steam()?;
            let window = wait_for_cs2_window()?;
            log::info!("CS2 window detected after Steam launch");
            window
        }
    };
    focus_cs2(window)?;

    send_key(CONSOLE_KEY)?;
    thread::sleep(Duration::from_millis(350));
    let normalized_path = console_path(&path).replace('\\', "/");
    send_unicode_text(&format!("playdemo \"{normalized_path}\""))?;
    send_key(VK_RETURN)?;
    thread::sleep(Duration::from_millis(150));
    send_key(CONSOLE_KEY)?;

    Ok("Demo enviada ao console do CS2.".to_string())
}

fn launch_cs2_via_steam() -> Result<(), String> {
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let uri: Vec<u16> = "steam://rungameid/730\0".encode_utf16().collect();
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            uri.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    let result_code = result as isize;
    if result_code <= 32 {
        return Err(format!(
            "O Windows não conseguiu iniciar o CS2 pelo Steam (erro {result_code})."
        ));
    }
    Ok(())
}

fn wait_for_cs2_window() -> Result<HWND, String> {
    let deadline = Instant::now() + CS2_LAUNCH_TIMEOUT;
    loop {
        if let Some(window) = find_cs2_window() {
            return Ok(window);
        }
        if Instant::now() >= deadline {
            return Err(
                "O CS2 não abriu em até dois minutos. Confira o Steam e tente novamente."
                    .to_string(),
            );
        }
        thread::sleep(Duration::from_secs(1));
    }
}

fn validate_demo_path(path: &str) -> Result<PathBuf, String> {
    if path.len() > 2048
        || path
            .chars()
            .any(|character| character.is_control() || matches!(character, '"' | ';'))
    {
        return Err("O caminho da demo contém caracteres inválidos.".to_string());
    }
    let requested_path = Path::new(path);
    if !requested_path.is_absolute()
        || !requested_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("dem"))
    {
        return Err("O caminho precisa apontar para um arquivo .dem absoluto.".to_string());
    }
    let canonical_path = fs::canonicalize(requested_path)
        .map_err(|error| format!("Não consegui acessar o arquivo da demo: {error}"))?;
    if !canonical_path.is_file() {
        return Err("O arquivo da demo não existe.".to_string());
    }
    let command_path = console_path(&canonical_path);
    if command_path
        .chars()
        .any(|character| matches!(character, '"' | ';' | '\r' | '\n'))
    {
        return Err("O caminho da demo não pode ser enviado com segurança ao console.".to_string());
    }
    Ok(canonical_path)
}

fn console_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(unc_path) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc_path}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
    }
}

unsafe extern "system" fn collect_cs2_window(hwnd: HWND, context: isize) -> BOOL {
    if IsWindowVisible(hwnd) == 0 {
        return TRUE;
    }
    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process_id);
    if process_id == 0 || !is_cs2_process(process_id) {
        return TRUE;
    }
    *(context as *mut HWND) = hwnd;
    0
}

unsafe fn is_cs2_process(process_id: u32) -> bool {
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
    if process.is_null() {
        return false;
    }
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
    CloseHandle(process);
    if ok == 0 || length == 0 {
        return false;
    }
    Path::new(&String::from_utf16_lossy(&buffer[..length as usize]))
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("cs2.exe"))
}

fn find_cs2_window() -> Option<HWND> {
    let mut window: HWND = null_mut();
    unsafe {
        EnumWindows(Some(collect_cs2_window), &mut window as *mut HWND as isize);
    }
    if window.is_null() {
        None
    } else {
        Some(window)
    }
}

fn focus_cs2(window: HWND) -> Result<(), String> {
    unsafe {
        ShowWindow(window, SW_RESTORE);
        BringWindowToTop(window);
        SetForegroundWindow(window);
        thread::sleep(Duration::from_millis(300));
        if GetForegroundWindow() != window {
            return Err(
                "O Windows não permitiu focar o CS2. Traga o CS2 para frente e tente novamente."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn keyboard_input(virtual_key: u16, scan_code: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                wScan: scan_code,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send_key(virtual_key: u16) -> Result<(), String> {
    let mut inputs = [
        keyboard_input(virtual_key, 0, 0),
        keyboard_input(virtual_key, 0, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        return Err("O Windows não aceitou o comando de teclado para o CS2.".to_string());
    }
    Ok(())
}

fn send_unicode_text(text: &str) -> Result<(), String> {
    let mut inputs = Vec::with_capacity(text.encode_utf16().count() * 2);
    for unit in text.encode_utf16() {
        inputs.push(keyboard_input(0, unit, KEYEVENTF_UNICODE));
        inputs.push(keyboard_input(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        return Err("O Windows não aceitou o texto do comando para o CS2.".to_string());
    }
    Ok(())
}
