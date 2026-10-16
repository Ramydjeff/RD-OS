use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Every backend failure that can reach the UI. Errors are serialized as
/// `{ kind, message }` so the frontend can branch on `kind` and show `message`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("WSL is not available: {0}")]
    WslUnavailable(String),
    #[error("Distribution not found: {0}")]
    DistroNotFound(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("The path is outside the project root")]
    PathOutsideRoot,
    #[error("Already exists: {0}")]
    AlreadyExists(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Terminal session not found: {0}")]
    SessionNotFound(String),
    #[error("A terminal session with this id already exists")]
    SessionExists,
    #[error("Process error: {0}")]
    Process(String),
    #[error("Terminal (PTY) error: {0}")]
    Pty(String),
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Not allowed: {0}")]
    Denied(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::WslUnavailable(_) => "wsl_unavailable",
            AppError::DistroNotFound(_) => "distro_not_found",
            AppError::InvalidInput(_) => "invalid_input",
            AppError::PathOutsideRoot => "path_outside_root",
            AppError::AlreadyExists(_) => "already_exists",
            AppError::NotFound(_) => "not_found",
            AppError::SessionNotFound(_) => "session_not_found",
            AppError::SessionExists => "session_exists",
            AppError::Process(_) => "process",
            AppError::Pty(_) => "pty",
            AppError::Io(_) => "io",
            AppError::Denied(_) => "denied",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(e.to_string()),
            std::io::ErrorKind::AlreadyExists => AppError::AlreadyExists(e.to_string()),
            std::io::ErrorKind::PermissionDenied => AppError::Denied(e.to_string()),
            _ => AppError::Io(e.to_string()),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_message() {
        let v = serde_json::to_value(AppError::DistroNotFound("x".into())).unwrap();
        assert_eq!(v["kind"], "distro_not_found");
        assert_eq!(v["message"], "Distribution not found: x");
    }

    #[test]
    fn maps_io_errors() {
        let e: AppError = std::io::Error::from(std::io::ErrorKind::NotFound).into();
        assert_eq!(e.kind(), "not_found");
    }
}
