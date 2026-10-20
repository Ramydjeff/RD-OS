//! Real Windows icons for the desktop: programs, shortcuts (.lnk, .url, web
//! apps installed from Chrome or Edge), folders and files, exactly as Windows
//! shows them. The shell renders each icon; it is sent to the UI as a PNG data
//! URL and cached in memory and on disk (keyed by path, size and mtime).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;

/// Pixel size asked from the shell; tiles show icons at up to ~90 physical pixels.
pub const ICON_PX: i32 = 96;
/// Paths per request, so one call never blocks the UI for long.
pub const MAX_BATCH: usize = 64;
const MAX_MEMORY: usize = 4000;

pub struct Rgba {
    pub w: u32,
    pub h: u32,
    pub px: Vec<u8>,
}

pub struct IconCache {
    dir: PathBuf,
    memory: Mutex<HashMap<String, Option<String>>>,
}

impl IconCache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, memory: Mutex::new(HashMap::new()) }
    }

    /// One entry per path: a `data:image/png` URL, or None when there is no icon.
    pub fn data_urls(&self, paths: &[String]) -> Vec<Option<String>> {
        paths.iter().map(|p| self.data_url(p)).collect()
    }

    fn data_url(&self, raw: &str) -> Option<String> {
        let path = Path::new(raw);
        if raw.len() > 1024 || !path.is_absolute() {
            return None;
        }
        let key = cache_key(path)?;
        if let Some(hit) = self.memory.lock().ok().and_then(|m| m.get(&key).cloned()) {
            return hit;
        }
        let file = self.dir.join(format!("{key}.png"));
        let png = fs::read(&file).ok().or_else(|| {
            let png = encode_png(&trim(extract(path)?))?;
            let _ = fs::create_dir_all(&self.dir).and_then(|_| fs::write(&file, &png));
            Some(png)
        });
        let url = png.map(|bytes| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
        if let Ok(mut m) = self.memory.lock() {
            if m.len() >= MAX_MEMORY {
                m.clear();
            }
            m.insert(key, url.clone());
        }
        url
    }
}

/// Changes whenever the file is replaced or updated, so a new icon is picked up.
fn cache_key(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let text = format!("{}|{}|{}|{}", path.display().to_string().to_lowercase(), meta.len(), mtime, ICON_PX);
    for b in text.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    Some(format!("{h:016x}"))
}

/// Small icons (32/48 px) come back drawn in the middle of a large transparent
/// canvas: crop to the drawing so they fill the tile like the others.
pub fn trim(img: Rgba) -> Rgba {
    let (w, h) = (img.w as usize, img.h as usize);
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if img.px[(y * w + x) * 4 + 3] > 8 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
            }
        }
    }
    if x1 <= x0 || y1 <= y0 {
        return img;
    }
    let content = (x1 - x0).max(y1 - y0);
    if content * 10 >= w * 6 {
        return img;
    }
    let side = (content + content / 8).min(w).min(h);
    let sx = ((x0 + x1) / 2).saturating_sub(side / 2).min(w - side);
    let sy = ((y0 + y1) / 2).saturating_sub(side / 2).min(h - side);
    let mut px = Vec::with_capacity(side * side * 4);
    for y in sy..sy + side {
        px.extend_from_slice(&img.px[(y * w + sx) * 4..(y * w + sx + side) * 4]);
    }
    Rgba { w: side as u32, h: side as u32, px }
}

pub fn encode_png(img: &Rgba) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.w, img.h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&img.px).ok()?;
    }
    Some(out)
}

#[cfg(windows)]
pub fn extract(path: &Path) -> Option<Rgba> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY};

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: COM is initialised and released on this thread around the calls;
    // `wide` is NUL-terminated and outlives them; the bitmap is freed once read.
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let result = (|| {
            let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
            let bitmap = factory.GetImage(SIZE { cx: ICON_PX, cy: ICON_PX }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK).ok()?;
            let img = read_bitmap(bitmap);
            let _ = DeleteObject(bitmap.into());
            img
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(windows)]
unsafe fn read_bitmap(bitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<Rgba> {
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    let mut bm = BITMAP::default();
    if GetObjectW(bitmap.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut BITMAP as *mut c_void)) == 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
    if w <= 0 || h <= 0 || w > 1024 || h > 1024 {
        return None;
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let hdc = GetDC(None);
    let lines = GetDIBits(hdc, bitmap, 0, h as u32, Some(px.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS);
    ReleaseDC(None, hdc);
    if lines == 0 {
        return None;
    }
    let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
    // The shell hands back premultiplied BGRA; PNG wants straight RGBA.
    let premultiplied = has_alpha && px.chunks_exact(4).all(|p| p[0].max(p[1]).max(p[2]) <= p[3]);
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        if !has_alpha {
            p[3] = 255;
        } else if premultiplied && p[3] > 0 && p[3] < 255 {
            let a = u32::from(p[3]);
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    Some(Rgba { w: w as u32, h: h as u32, px })
}

#[cfg(not(windows))]
pub fn extract(_path: &Path) -> Option<Rgba> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canvas(side: u32, square: std::ops::Range<u32>) -> Rgba {
        let mut px = vec![0u8; (side * side * 4) as usize];
        for y in square.clone() {
            for x in square.clone() {
                px[((y * side + x) * 4 + 3) as usize] = 255;
            }
        }
        Rgba { w: side, h: side, px }
    }

    #[test]
    fn trim_crops_small_icons_and_keeps_full_ones() {
        let small = trim(canvas(96, 32..64));
        assert_eq!((small.w, small.h), (36, 36));
        assert_eq!(small.px.len(), 36 * 36 * 4);
        let full = trim(canvas(96, 6..90));
        assert_eq!((full.w, full.h), (96, 96));
        let empty = trim(canvas(96, 0..0));
        assert_eq!(empty.w, 96);
    }

    #[test]
    fn png_has_the_signature() {
        let png = encode_png(&canvas(8, 0..8)).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn rejects_relative_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let cache = IconCache::new(dir.path().join("icons"));
        let out = cache.data_urls(&["relative\\app.exe".into(), "C:\\does\\not\\exist.exe".into()]);
        assert_eq!(out, vec![None, None]);
    }

    #[test]
    fn cache_key_follows_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        fs::write(&f, b"1").unwrap();
        let k1 = cache_key(&f).unwrap();
        fs::write(&f, b"22").unwrap();
        assert_ne!(k1, cache_key(&f).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn extracts_a_system_program_icon_and_caches_it() {
        let Some(root) = std::env::var_os("SystemRoot") else { return };
        let exe = PathBuf::from(root).join("System32").join("notepad.exe");
        if !exe.is_file() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let cache = IconCache::new(dir.path().join("icons"));
        let url = cache.data_urls(&[exe.display().to_string()]).remove(0).expect("notepad has an icon");
        assert!(url.starts_with("data:image/png;base64,"));
        assert_eq!(fs::read_dir(dir.path().join("icons")).unwrap().count(), 1);
    }
}
