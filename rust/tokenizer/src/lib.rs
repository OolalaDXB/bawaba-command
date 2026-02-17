pub mod regex;
pub mod vault;

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use uuid::Uuid;

use crate::regex::{luhn_check, PATTERNS};
use crate::vault::{global_vault, init_global_vault};

/// Result returned from tokenization.
#[repr(C)]
pub struct CTokenizationResult {
    pub output: *mut c_char,
    pub entities_count: u32,
    pub tokens_generated: u32,
    pub processing_us: u64,
}

/// Initialize the vault with a TTL in seconds.
#[no_mangle]
pub extern "C" fn bawaba_vault_init(ttl_secs: u64) {
    init_global_vault(ttl_secs);
}

/// Tokenize PII in the input text.
/// scope: "tenant_id:session_id"
/// Returns a CTokenizationResult. Caller must free the output string with bawaba_free_string.
#[no_mangle]
pub extern "C" fn bawaba_tokenize(
    input: *const c_char,
    scope: *const c_char,
) -> CTokenizationResult {
    let start = std::time::Instant::now();

    let input_str = unsafe {
        if input.is_null() {
            return empty_result();
        }
        match CStr::from_ptr(input).to_str() {
            Ok(s) => s,
            Err(_) => return empty_result(),
        }
    };

    let scope_str = unsafe {
        if scope.is_null() {
            "default:default"
        } else {
            CStr::from_ptr(scope).to_str().unwrap_or("default:default")
        }
    };

    let mut output = input_str.to_string();
    let mut entities_count: u32 = 0;
    let mut tokens_generated: u32 = 0;

    // Collect all matches first, then replace from end to preserve positions
    let mut matches: Vec<(usize, usize, &str, String)> = Vec::new();

    for pattern in PATTERNS {
        for m in pattern.regex.find_iter(input_str) {
            let matched = m.as_str();

            // For credit cards, validate with Luhn
            if pattern.name == "card" {
                if !luhn_check(matched) {
                    continue;
                }
            }

            matches.push((m.start(), m.end(), pattern.name, matched.to_string()));
        }
    }

    // Sort by start position descending so we can replace from the end
    matches.sort_by(|a, b| b.0.cmp(&a.0));

    // Deduplicate overlapping matches (keep the first/longest match)
    let mut deduped: Vec<(usize, usize, &str, String)> = Vec::new();
    for m in matches {
        let overlaps = deduped.iter().any(|d| {
            (m.0 >= d.0 && m.0 < d.1) || (m.1 > d.0 && m.1 <= d.1)
        });
        if !overlaps {
            deduped.push(m);
        }
    }

    for (start_pos, end_pos, entity_type, original) in &deduped {
        let uuid = Uuid::new_v4();
        let token = format!("{{{{PII:{}}}}}", uuid);

        // Store in vault
        let vault = global_vault();
        vault.store_token(scope_str, uuid, original, entity_type);

        // Replace in output
        output.replace_range(start_pos..end_pos, &token);

        entities_count += 1;
        tokens_generated += 1;
    }

    let elapsed = start.elapsed().as_micros() as u64;

    let c_output = CString::new(output).unwrap_or_else(|_| CString::new("").unwrap());

    CTokenizationResult {
        output: c_output.into_raw(),
        entities_count,
        tokens_generated,
        processing_us: elapsed,
    }
}

/// De-tokenize: replace PII tokens with original values from vault.
#[no_mangle]
pub extern "C" fn bawaba_detokenize(
    input: *const c_char,
    scope: *const c_char,
) -> *mut c_char {
    let input_str = unsafe {
        if input.is_null() {
            return CString::new("").unwrap().into_raw();
        }
        match CStr::from_ptr(input).to_str() {
            Ok(s) => s,
            Err(_) => return CString::new("").unwrap().into_raw(),
        }
    };

    let scope_str = unsafe {
        if scope.is_null() {
            "default:default"
        } else {
            CStr::from_ptr(scope).to_str().unwrap_or("default:default")
        }
    };

    let vault = global_vault();
    let mut output = input_str.to_string();

    // Find all {PII:uuid} tokens and replace with originals
    let token_re = ::regex::Regex::new(r"\{PII:([0-9a-f\-]{36})\}").unwrap();

    let result = token_re.replace_all(&output, |caps: &::regex::Captures| {
        let uuid_str = caps.get(1).unwrap().as_str();
        if let Ok(uuid) = Uuid::parse_str(uuid_str) {
            if let Some(original) = vault.lookup(scope_str, &uuid) {
                return original;
            }
        }
        // If not found, return the token as-is (fail-safe)
        caps.get(0).unwrap().as_str().to_string()
    });

    output = result.to_string();

    CString::new(output).unwrap_or_else(|_| CString::new("").unwrap()).into_raw()
}

/// Purge expired tokens from the vault.
#[no_mangle]
pub extern "C" fn bawaba_vault_purge() {
    global_vault().purge_expired();
}

/// Free a string allocated by the tokenizer.
#[no_mangle]
pub extern "C" fn bawaba_free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe {
            let _ = CString::from_raw(s);
        }
    }
}

fn empty_result() -> CTokenizationResult {
    let c_output = CString::new("").unwrap();
    CTokenizationResult {
        output: c_output.into_raw(),
        entities_count: 0,
        tokens_generated: 0,
        processing_us: 0,
    }
}
