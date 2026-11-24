//! Shared execution of the declarative Design contract.

mod contract;

use serde_json::Value;

/// Run a Design operation against the text of the current project contract.
#[must_use]
pub fn run_contract(config: Option<&str>, operation: &str, input: Value) -> Value {
    contract::run(config, operation, input)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::{contract::CONFIG, run_contract};
    use extism_pdk::{FnResult, Json, host_fn, plugin_fn};
    use serde::Deserialize;
    use serde_json::{Value, json};
    use std::cell::RefCell;

    #[host_fn("extism:host/user")]
    unsafe extern "ExtismHost" {
        fn read_file(path: String) -> String;
    }

    fn workflow(context: &Value, operation: &str) -> FnResult<Json<Value>> {
        let result = if context["abi_version"] == 1 {
            // SAFETY: the Extism PDK owns the host memory handles.
            let file: Option<String> = serde_json::from_str(&unsafe { read_file(CONFIG.into())? })?;
            run_contract(file.as_deref(), operation, context["input"].clone())
        } else {
            json!({"ok":false,"diagnostics":[{"code":"request.abi","severity":"error","message":"Expected Lenso ABI v1."}]})
        };
        Ok(Json(json!({"status":"complete","output":result})))
    }

    #[plugin_fn]
    pub fn inspect(Json(context): Json<Value>) -> FnResult<Json<Value>> {
        workflow(&context, "inspect")
    }

    #[plugin_fn]
    pub fn resolve(Json(context): Json<Value>) -> FnResult<Json<Value>> {
        workflow(&context, "resolve")
    }

    #[plugin_fn]
    pub fn query(Json(context): Json<Value>) -> FnResult<Json<Value>> {
        workflow(&context, "query")
    }

    #[plugin_fn]
    pub fn check(Json(context): Json<Value>) -> FnResult<Json<Value>> {
        workflow(&context, "check")
    }

    // The standalone CLI calls the same module through its own memory exports.
    const MAX_REQUEST: usize = 2 * 1024 * 1024;
    thread_local! {
        static REQUEST: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    #[derive(Deserialize)]
    struct Request {
        config: Option<String>,
        operation: String,
        input: Value,
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn design_input(length: usize) -> *mut u8 {
        if length > MAX_REQUEST {
            return std::ptr::null_mut();
        }
        REQUEST.with_borrow_mut(|bytes| {
            bytes.resize(length, 0);
            bytes.as_mut_ptr()
        })
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn design_run() -> usize {
        let result = REQUEST.with_borrow(|bytes| match serde_json::from_slice::<Request>(bytes) {
            Ok(request) => run_contract(request.config.as_deref(), &request.operation, request.input),
            Err(_) => json!({"ok":false,"diagnostics":[{"code":"request.input","severity":"error","message":"Invalid standalone Design request."}]}),
        });
        RESPONSE.with_borrow_mut(|bytes| {
            *bytes = result.to_string().into_bytes();
            bytes.len()
        })
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn design_output() -> *const u8 {
        RESPONSE.with_borrow(Vec::as_ptr)
    }
}
