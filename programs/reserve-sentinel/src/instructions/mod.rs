pub mod initialize_asset;
pub mod update_score;

// Glob re-export is required: the #[program] macro expects the account-context
// structs AND the derive-generated `__client_accounts_*` / `__cpi_*` modules to
// be in scope here. Handler fns are named distinctly per module (not `handler`)
// so these globs don't produce an ambiguous re-export.
pub use initialize_asset::*;
pub use update_score::*;
