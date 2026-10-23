use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{IpAddr, ToSocketAddrs},
    time::Duration,
};

use reqwest::{
    blocking::{Client, Response},
    header::{HeaderValue, CONTENT_LENGTH, CONTENT_TYPE, COOKIE, LOCATION, REFERER, USER_AGENT},
    redirect::Policy,
    StatusCode, Url,
};

use crate::demo_storage::DemoStorage;

const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_COOKIE_BYTES: usize = 8 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const PROGRESS_LOG_BYTES: u64 = 64 * 1024 * 1024;
const BUFFER_BYTES: usize = 128 * 1024;
const GC_ORIGIN: &str = "https://gamersclub.com.br";

pub fn download(
    url: &str,
    cookies: &str,
    match_id: &str,
    storage: &DemoStorage,
) -> Result<std::path::PathBuf, String> {
    let initial_url = validate_url(url)?;
    if !valid_match_id(match_id) {
        return Err("O identificador da partida é inválido.".to_string());
    }
    if cookies.len() > MAX_COOKIE_BYTES || cookies.chars().any(char::is_control) {
        return Err("Os dados de autenticação da GC são inválidos.".to_string());
    }
    let send_cookies = is_gc_host(initial_url.host_str().unwrap_or_default());
    let cookie_header = if send_cookies { cookies } else { "" };
    let host = initial_url.host_str().unwrap_or("unknown");
    log::info!("GC demo download requested for match {match_id} from host {host}");

    let (partial_path, completed_path) = storage.new_download_paths(match_id)?;
    let partial_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial_path)
        .map_err(|error| format!("Não consegui criar o arquivo temporário da demo: {error}"))?;
    let result = download_to_partial(&initial_url, cookie_header, match_id, partial_file);
    if let Err(error) = result {
        let _ = fs::remove_file(&partial_path);
        return Err(error);
    }
    match storage.store_completed(&partial_path, &completed_path, match_id) {
        Ok(path) => Ok(path),
        Err(error) => {
            let _ = fs::remove_file(&partial_path);
            Err(error)
        }
    }
}

fn download_to_partial(
    initial_url: &Url,
    cookies: &str,
    match_id: &str,
    mut output: File,
) -> Result<(), String> {
    let mut current_url = initial_url.clone();
    let mut response: Option<Response> = None;
    for redirect_number in 0..=MAX_REDIRECTS {
        let client = download_client(&current_url)?;
        let mut request = client
            .get(current_url.clone())
            .header(
                USER_AGENT,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            );
        if is_gc_host(current_url.host_str().unwrap_or_default()) {
            request = request.header(REFERER, format!("{GC_ORIGIN}/lobby/match/{match_id}"));
        }
        if same_origin(initial_url, &current_url) && !cookies.is_empty() {
            let cookie_header = HeaderValue::from_str(cookies)
                .map_err(|_| "Os dados de autenticação da GC são inválidos.".to_string())?;
            request = request.header(COOKIE, cookie_header);
        }

        let result = request.send().map_err(|error| {
            log::error!("GC demo network request failed: {}", error.without_url());
            "Não consegui baixar a demo da GC. Consulte o log do P2P-Cast.".to_string()
        })?;
        if result.status().is_redirection() {
            if redirect_number == MAX_REDIRECTS {
                return Err("A GC redirecionou a demo vezes demais.".to_string());
            }
            let location = result
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "A GC retornou um redirecionamento inválido.".to_string())?;
            current_url = current_url
                .join(location)
                .map_err(|_| "A GC retornou um redirecionamento inválido.".to_string())?;
            current_url = validate_url(current_url.as_str())?;
            log::info!(
                "GC demo download followed redirect {} to host {}",
                redirect_number + 1,
                current_url.host_str().unwrap_or("unknown")
            );
            continue;
        }
        response = Some(result);
        break;
    }

    let mut response =
        response.ok_or_else(|| "A GC não retornou o arquivo da demo.".to_string())?;
    if response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::FORBIDDEN {
        log::error!(
            "GC rejected the demo download with HTTP {}",
            response.status()
        );
        return Err(
            "A GC recusou o link da demo. Ele pode ter expirado ou exigir uma nova sessão."
                .to_string(),
        );
    }
    if !response.status().is_success() {
        log::error!("GC demo download returned HTTP {}", response.status());
        return Err(format!(
            "A GC respondeu com HTTP {} ao baixar a demo.",
            response.status()
        ));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if content_type.starts_with("text/")
        || content_type.contains("application/json")
        || content_type.contains("application/xml")
    {
        log::error!(
            "GC demo download returned an authentication or API response instead of a demo file"
        );
        return Err(
            "A GC não retornou o arquivo da demo. O link pode ter expirado ou sua sessão precisa ser renovada."
                .to_string(),
        );
    }
    let expected_length = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if expected_length.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err("A demo excede o limite de 8 GB.".to_string());
    }

    let mut buffer = [0u8; BUFFER_BYTES];
    let mut downloaded = 0u64;
    let mut next_log = PROGRESS_LOG_BYTES;
    loop {
        let count = response.read(&mut buffer).map_err(|error| {
            log::error!("GC demo stream failed after {downloaded} bytes: {error}");
            "A conexão caiu durante o download da demo. Consulte o log do P2P-Cast.".to_string()
        })?;
        if count == 0 {
            break;
        }
        downloaded = downloaded.saturating_add(count as u64);
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err("A demo excede o limite de 8 GB.".to_string());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| format!("Não consegui salvar a demo temporária: {error}"))?;
        if downloaded >= next_log {
            log::info!("GC demo download progress: {downloaded} bytes received");
            next_log = next_log.saturating_add(PROGRESS_LOG_BYTES);
        }
    }
    output
        .flush()
        .map_err(|error| format!("Não consegui finalizar o arquivo temporário da demo: {error}"))?;
    if downloaded == 0 || expected_length.is_some_and(|expected| expected != downloaded) {
        return Err("O download da demo ficou incompleto.".to_string());
    }
    log::info!("GC demo download stream finished with {downloaded} bytes");
    Ok(())
}

fn validate_url(value: &str) -> Result<Url, String> {
    if value.len() > MAX_URL_BYTES || value.chars().any(char::is_control) {
        return Err("A URL da demo é inválida ou muito grande.".to_string());
    }
    let url = Url::parse(value).map_err(|_| "A URL da demo é inválida.".to_string())?;
    if url.scheme() != "https:" || !url.username().is_empty() || url.password().is_some() {
        return Err("A GC precisa enviar uma URL HTTPS válida.".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "A URL da demo não contém um host.".to_string())?;
    if host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().ends_with(".localhost")
        || host.to_ascii_lowercase().ends_with(".local")
        || host.parse::<IpAddr>().is_ok()
    {
        return Err("A URL da demo aponta para um host não permitido.".to_string());
    }
    Ok(url)
}

fn download_client(url: &Url) -> Result<Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "A URL da demo não contém um host.".to_string())?;
    let port = url.port_or_known_default().unwrap_or(443);
    let address = (host, port)
        .to_socket_addrs()
        .map_err(|_| "Não consegui localizar o servidor da demo.".to_string())?
        .find(|address| is_public_address(address.ip()))
        .ok_or_else(|| "O servidor da demo resolveu para um endereço privado.".to_string())?;
    Client::builder()
        .redirect(Policy::none())
        .resolve(host, address)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|_| "Não consegui preparar a conexão segura com o servidor da demo.".to_string())
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, _] = address.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 0 || b == 168))
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(address) => {
            let octets = address.octets();
            if octets[..10] == [0; 10] && octets[10..12] == [0xff, 0xff] {
                return is_public_address(IpAddr::V4(std::net::Ipv4Addr::new(
                    octets[12], octets[13], octets[14], octets[15],
                )));
            }
            let segments = address.segments();
            !address.is_unspecified()
                && !address.is_loopback()
                && !address.is_multicast()
                && (segments[0] & 0xe000) == 0x2000
                && (segments[0] & 0xfe00) != 0xfc00
                && (segments[0] & 0xffc0) != 0xfe80
                && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn is_gc_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("gamersclub.com.br")
        || host.to_ascii_lowercase().ends_with(".gamersclub.com.br")
}

fn valid_match_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
