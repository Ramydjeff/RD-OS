//! Project templates (Python, C/C++, Computer Vision, Node.js).
//!
//! Creating a project writes a handful of small text files and nothing else.
//! Existing files are never overwritten. Dependencies are never installed
//! implicitly; the only optional action is `python3 -m venv .venv`, which runs
//! inside the distribution and only when the user ticked it.

use std::fs;
use std::io::Write;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::location::Location;
use crate::{fsops, wsl};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub files: Vec<String>,
}

struct Template {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    files: &'static [(&'static str, &'static str)],
}

const PY_GITIGNORE: &str = "__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.env\n*.egg-info/\ndist/\nbuild/\n.pytest_cache/\n.mypy_cache/\n";

const TEMPLATES: &[Template] = &[
    Template {
        id: "python",
        label: "Python",
        description: "A minimal Python 3 program.",
        files: &[
            (
                "main.py",
                "def main() -> None:\n    print(\"Hello from {{name}}!\")\n\n\nif __name__ == \"__main__\":\n    main()\n",
            ),
            (
                "README.md",
                "# {{name}}\n\nA Python project.\n\n## Run\n\n```bash\npython3 main.py\n```\n\n## Virtual environment (optional)\n\n```bash\npython3 -m venv .venv\nsource .venv/bin/activate\n```\n",
            ),
            (".gitignore", PY_GITIGNORE),
        ],
    },
    Template {
        id: "cpp",
        label: "C and C++",
        description: "A C++17 program built with CMake.",
        files: &[
            (
                "main.cpp",
                "#include <iostream>\n\nint main() {\n    std::cout << \"Hello from {{name}}!\" << std::endl;\n    return 0;\n}\n",
            ),
            (
                "CMakeLists.txt",
                "cmake_minimum_required(VERSION 3.16)\nproject({{name}} LANGUAGES CXX)\n\nset(CMAKE_CXX_STANDARD 17)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\nset(CMAKE_EXPORT_COMPILE_COMMANDS ON)\n\nadd_executable({{name}} main.cpp)\n",
            ),
            (
                "README.md",
                "# {{name}}\n\nA C++ project built with CMake.\n\n## Requirements\n\n```bash\nsudo apt update && sudo apt install -y build-essential cmake\n```\n\n## Build and run\n\n```bash\ncmake -S . -B build\ncmake --build build\n./build/{{name}}\n```\n",
            ),
            (".gitignore", "build/\n.cache/\ncompile_commands.json\n"),
        ],
    },
    Template {
        id: "vision",
        label: "Computer Vision",
        description: "An OpenCV starter. Dependencies are listed, not installed.",
        files: &[
            (
                "main.py",
                "\"\"\"Minimal OpenCV example: load an image, convert to grayscale, save it.\"\"\"\n\nimport sys\n\ntry:\n    import cv2\nexcept ImportError:\n    sys.exit(\"OpenCV is not installed. See README.md for installation instructions.\")\n\n\ndef main() -> None:\n    if len(sys.argv) != 3:\n        sys.exit(\"usage: python3 main.py <input-image> <output-image>\")\n    image = cv2.imread(sys.argv[1])\n    if image is None:\n        sys.exit(f\"could not read image: {sys.argv[1]}\")\n    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)\n    cv2.imwrite(sys.argv[2], gray)\n    print(f\"saved {sys.argv[2]} ({gray.shape[1]}x{gray.shape[0]})\")\n\n\nif __name__ == \"__main__\":\n    main()\n",
            ),
            ("requirements.txt", "opencv-python-headless>=4.9\nnumpy>=1.26\n"),
            (
                "README.md",
                "# {{name}}\n\nA computer vision starter using OpenCV.\n\n## Install dependencies\n\nUse a virtual environment so the packages stay inside this project:\n\n```bash\npython3 -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt\n```\n\n`opencv-python-headless` has no GUI dependencies. If you need `cv2.imshow` under WSLg, install `opencv-python` instead.\n\n## Run\n\n```bash\npython3 main.py input.jpg output.jpg\n```\n\nModel weights and datasets are not downloaded automatically; keep large files out of git.\n",
            ),
            (".gitignore", "__pycache__/\n.venv/\n*.pt\n*.onnx\n*.weights\ndata/\n"),
        ],
    },
    Template {
        id: "node",
        label: "Node.js",
        description: "A minimal Node.js package.",
        files: &[
            (
                "package.json",
                "{\n  \"name\": \"{{npmname}}\",\n  \"version\": \"0.1.0\",\n  \"description\": \"\",\n  \"main\": \"index.js\",\n  \"scripts\": {\n    \"start\": \"node index.js\"\n  },\n  \"license\": \"UNLICENSED\",\n  \"private\": true\n}\n",
            ),
            ("index.js", "console.log('Hello from {{name}}!');\n"),
            (
                "README.md",
                "# {{name}}\n\nA Node.js project.\n\n## Run\n\n```bash\nnpm start\n```\n",
            ),
            (".gitignore", "node_modules/\n.env\ndist/\n"),
        ],
    },
];

pub fn list_templates() -> Vec<TemplateInfo> {
    TEMPLATES
        .iter()
        .map(|t| TemplateInfo {
            id: t.id.into(),
            label: t.label.into(),
            description: t.description.into(),
            files: t.files.iter().map(|(n, _)| n.to_string()).collect(),
        })
        .collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub parent: Location,
    pub name: String,
    pub template: String,
    /// The user confirmed that `<parent>/<name>` already exists and may be
    /// extended. Existing files are still never overwritten.
    #[serde(default)]
    pub allow_existing: bool,
    #[serde(default)]
    pub create_venv: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VenvOutcome {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResult {
    pub location: Location,
    pub created: Vec<String>,
    pub skipped: Vec<String>,
    pub venv: Option<VenvOutcome>,
}

pub fn validate_project_name(name: &str) -> AppResult<()> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false)
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !name.ends_with('.');
    if ok {
        fsops::validate_entry_name(name)
    } else {
        Err(AppError::InvalidInput(
            "Project names may use letters, digits, '.', '_' and '-' (max 64 characters) and must start with a letter or digit.".into(),
        ))
    }
}

fn npm_name(name: &str) -> String {
    let cleaned: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' { c } else { '-' })
        .collect();
    cleaned.trim_start_matches(['.', '_']).to_string()
}

fn render(content: &str, name: &str) -> String {
    content.replace("{{npmname}}", &npm_name(name)).replace("{{name}}", name)
}

pub fn create_project(req: &CreateProjectRequest) -> AppResult<CreateProjectResult> {
    validate_project_name(&req.name)?;
    let template = TEMPLATES
        .iter()
        .find(|t| t.id == req.template)
        .ok_or_else(|| AppError::InvalidInput(format!("unknown template '{}'", req.template)))?;

    let parent = req.parent.normalized()?;
    if parent.is_too_broad_for_writes() {
        return Err(AppError::Denied(format!(
            "{} is too broad to create a project in. Choose a sub-folder.",
            parent.display()
        )));
    }
    let parent_host = parent.host_path()?;
    if !fs::metadata(&parent_host).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(AppError::NotFound(format!("the folder {} does not exist", parent.display())));
    }

    let target_host = parent_host.join(&req.name);
    match fs::symlink_metadata(&target_host) {
        Ok(m) if m.file_type().is_symlink() => {
            return Err(AppError::Denied("the target is a symbolic link; choose a different name".into()))
        }
        Ok(m) if !m.is_dir() => return Err(AppError::AlreadyExists(format!("{} is a file", req.name))),
        Ok(_) if !req.allow_existing => return Err(AppError::AlreadyExists(req.name.clone())),
        Ok(_) => {}
        Err(_) => fs::create_dir(&target_host)?,
    }

    let mut created = Vec::new();
    let mut skipped = Vec::new();
    for (file, content) in template.files {
        let path = target_host.join(file);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(render(content, &req.name).as_bytes())?;
                created.push(file.to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => skipped.push(file.to_string()),
            Err(e) => return Err(e.into()),
        }
    }

    let location = match &parent {
        Location::Linux { distro, path } => Location::Linux {
            distro: distro.clone(),
            path: format!("{}/{}", path.trim_end_matches('/'), req.name),
        },
        Location::Windows { path } => Location::Windows {
            path: format!("{}\\{}", path.trim_end_matches('\\'), req.name),
        },
    };

    let venv = if req.create_venv {
        Some(create_venv(&location, &req.template))
    } else {
        None
    };

    Ok(CreateProjectResult {
        location,
        created,
        skipped,
        venv,
    })
}

fn create_venv(location: &Location, template: &str) -> VenvOutcome {
    if template != "python" && template != "vision" {
        return VenvOutcome { ok: false, message: "This template does not use a Python virtual environment.".into() };
    }
    let Location::Linux { distro, path } = location else {
        return VenvOutcome {
            ok: false,
            message: "Virtual environments are only created for projects inside a WSL distribution. Open a terminal in the project and run `python3 -m venv .venv`.".into(),
        };
    };
    let result = wsl::exec_script(
        distro,
        "sh",
        r#"cd "$1" && python3 -m venv .venv"#,
        &[path],
        Duration::from_secs(180),
    );
    match result {
        Ok(out) if out.success() => VenvOutcome { ok: true, message: "Created .venv".into() },
        Ok(out) => {
            let err = wsl::decode_output(&out.stderr);
            let first = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("python3 -m venv failed");
            let hint = if err.contains("ensurepip") || err.contains("python3-venv") {
                " Install it with: sudo apt install python3-venv"
            } else {
                ""
            };
            VenvOutcome {
                ok: false,
                message: if out.timed_out { "Creating the virtual environment timed out.".into() } else { format!("{first}.{hint}") },
            }
        }
        Err(e) => VenvOutcome { ok: false, message: e.to_string() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn req(parent: &std::path::Path, name: &str, template: &str) -> CreateProjectRequest {
        CreateProjectRequest {
            parent: Location::Windows { path: parent.display().to_string() },
            name: name.into(),
            template: template.into(),
            allow_existing: false,
            create_venv: false,
        }
    }

    #[test]
    fn creates_every_template() {
        for t in list_templates() {
            let dir = tempdir().unwrap();
            let res = create_project(&req(dir.path(), "demo-app", &t.id)).unwrap();
            assert_eq!(res.created.len(), t.files.len(), "{}", t.id);
            for f in &t.files {
                let text = fs::read_to_string(dir.path().join("demo-app").join(f)).unwrap();
                assert!(!text.contains("{{"), "{} left a placeholder in {f}", t.id);
            }
        }
    }

    #[test]
    fn spec_files_exist_for_each_template() {
        let files = |id: &str| list_templates().into_iter().find(|t| t.id == id).unwrap().files;
        assert!(["main.py", "README.md", ".gitignore"].iter().all(|f| files("python").contains(&f.to_string())));
        assert!(["main.cpp", "CMakeLists.txt", "README.md"].iter().all(|f| files("cpp").contains(&f.to_string())));
        assert!(["main.py", "requirements.txt", "README.md"].iter().all(|f| files("vision").contains(&f.to_string())));
        assert!(["package.json", "README.md"].iter().all(|f| files("node").contains(&f.to_string())));
    }

    #[test]
    fn refuses_existing_project_without_confirmation() {
        let dir = tempdir().unwrap();
        create_project(&req(dir.path(), "p", "python")).unwrap();
        let err = create_project(&req(dir.path(), "p", "python")).unwrap_err();
        assert_eq!(err.kind(), "already_exists");
    }

    #[test]
    fn confirmed_merge_never_overwrites_existing_files() {
        let dir = tempdir().unwrap();
        let proj = dir.path().join("p");
        fs::create_dir(&proj).unwrap();
        fs::write(proj.join("main.py"), "# mine\n").unwrap();
        let mut r = req(dir.path(), "p", "python");
        r.allow_existing = true;
        let res = create_project(&r).unwrap();
        assert_eq!(res.skipped, vec!["main.py"]);
        assert_eq!(fs::read_to_string(proj.join("main.py")).unwrap(), "# mine\n");
        assert!(proj.join("README.md").exists());
    }

    #[test]
    fn rejects_bad_names_and_templates() {
        let dir = tempdir().unwrap();
        for bad in ["", "../x", "a/b", "a b", "-x", "con", "x.", ".hidden", "a;b"] {
            assert!(create_project(&req(dir.path(), bad, "python")).is_err(), "{bad:?}");
        }
        assert!(create_project(&req(dir.path(), "ok", "nope")).is_err());
    }

    #[test]
    fn node_package_name_is_lowercased() {
        let dir = tempdir().unwrap();
        create_project(&req(dir.path(), "MyApp", "node")).unwrap();
        let pkg = fs::read_to_string(dir.path().join("MyApp").join("package.json")).unwrap();
        assert!(pkg.contains("\"name\": \"myapp\""));
        let v: serde_json::Value = serde_json::from_str(&pkg).unwrap();
        assert_eq!(v["version"], "0.1.0");
    }

    #[test]
    fn broad_parent_is_refused() {
        let r = CreateProjectRequest {
            parent: Location::Windows { path: "C:\\".into() },
            name: "x".into(),
            template: "python".into(),
            allow_existing: false,
            create_venv: false,
        };
        assert_eq!(create_project(&r).unwrap_err().kind(), "denied");
    }
}
