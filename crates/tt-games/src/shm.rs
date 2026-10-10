//! Read-only access to a named Windows shared-memory block.

use std::ptr::NonNull;

use anyhow::{Result, bail};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Memory::{
    FILE_MAP_READ, MEMORY_BASIC_INFORMATION, MapViewOfFile, MEMORY_MAPPED_VIEW_ADDRESS,
    OpenFileMappingW, UnmapViewOfFile, VirtualQuery,
};

/// A read-only view of a named file mapping created by a game.
pub struct SharedMemory {
    handle: HANDLE,
    view: NonNull<u8>,
    /// Size of the mapped region as reported by the OS (page-rounded).
    region_size: usize,
}

// The view is read-only and only accessed through `copy_to`, which takes `&self`.
unsafe impl Send for SharedMemory {}

impl SharedMemory {
    /// Opens an existing mapping. Fails if the game has not created it.
    pub fn open(name: &str) -> Result<Self> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_READ, 0, wide.as_ptr());
            if handle.is_null() {
                bail!("shared memory '{name}' not found");
            }

            let MEMORY_MAPPED_VIEW_ADDRESS { Value: addr } = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
            let Some(view) = NonNull::new(addr.cast::<u8>()) else {
                CloseHandle(handle);
                bail!("could not map shared memory '{name}'");
            };

            let mut info: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
            VirtualQuery(view.as_ptr().cast(), &mut info, size_of::<MEMORY_BASIC_INFORMATION>());

            Ok(Self { handle, view, region_size: info.RegionSize })
        }
    }

    pub fn region_size(&self) -> usize {
        self.region_size
    }

    /// Copies the start of the block into `T`. Returns `None` if the block is too small.
    ///
    /// `T` must be a plain-old-data `#[repr(C)]` type for which any bit pattern is valid.
    pub fn read<T: Copy>(&self) -> Option<T> {
        if size_of::<T>() > self.region_size {
            return None;
        }
        // Volatile because the game writes this memory from another process.
        Some(unsafe { std::ptr::read_volatile(self.view.as_ptr().cast::<T>()) })
    }

    /// Copies the raw bytes of the block (for diagnostics / dumps).
    pub fn bytes(&self, len: usize) -> Vec<u8> {
        let len = len.min(self.region_size);
        let mut out = vec![0u8; len];
        unsafe { std::ptr::copy_nonoverlapping(self.view.as_ptr(), out.as_mut_ptr(), len) };
        out
    }
}

impl Drop for SharedMemory {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.view.as_ptr().cast() });
            CloseHandle(self.handle);
        }
    }
}
