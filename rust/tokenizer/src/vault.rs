use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub struct TokenMapping {
    pub uuid: Uuid,
    pub entity_type: String,
    pub original: String,
    pub start: usize,
    pub end: usize,
    pub created_at: Instant,
}

pub struct Vault {
    /// key: "tenant_id:session_id" -> (uuid -> original_value)
    store: Mutex<HashMap<String, HashMap<Uuid, VaultEntry>>>,
    ttl: Duration,
}

struct VaultEntry {
    original: String,
    entity_type: String,
    created_at: Instant,
}

impl Vault {
    pub fn new(ttl_secs: u64) -> Self {
        Vault {
            store: Mutex::new(HashMap::new()),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    pub fn store_token(
        &self,
        scope: &str,
        uuid: Uuid,
        original: &str,
        entity_type: &str,
    ) {
        let mut store = self.store.lock().unwrap();
        let scope_map = store.entry(scope.to_string()).or_insert_with(HashMap::new);
        scope_map.insert(
            uuid,
            VaultEntry {
                original: original.to_string(),
                entity_type: entity_type.to_string(),
                created_at: Instant::now(),
            },
        );
    }

    pub fn lookup(&self, scope: &str, uuid: &Uuid) -> Option<String> {
        let store = self.store.lock().unwrap();
        if let Some(scope_map) = store.get(scope) {
            if let Some(entry) = scope_map.get(uuid) {
                if entry.created_at.elapsed() < self.ttl {
                    return Some(entry.original.clone());
                }
            }
        }
        None
    }

    pub fn purge_expired(&self) {
        let mut store = self.store.lock().unwrap();
        for scope_map in store.values_mut() {
            scope_map.retain(|_, entry| entry.created_at.elapsed() < self.ttl);
        }
        store.retain(|_, scope_map| !scope_map.is_empty());
    }
}

// Global vault instance
static mut GLOBAL_VAULT: Option<Vault> = None;

pub fn init_global_vault(ttl_secs: u64) {
    unsafe {
        GLOBAL_VAULT = Some(Vault::new(ttl_secs));
    }
}

pub fn global_vault() -> &'static Vault {
    unsafe { GLOBAL_VAULT.as_ref().expect("vault not initialized") }
}
