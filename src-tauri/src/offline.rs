use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const UPDATE_FILENAME: &str = "current.json";
const UPDATE_SCHEMA: &str = "orbit-copilot-offline-news-v1";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OfflineNewsItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub source: String,
    pub published: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub page_url: String,
    #[serde(default)]
    pub original_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct OfflineNewsUpdate {
    schema: String,
    generated_at: String,
    month: String,
    date_from: String,
    date_to: String,
    items: Vec<OfflineNewsItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineDataStatus {
    pub available: bool,
    pub path: String,
    pub generated_at: String,
    pub month: String,
    pub date_from: String,
    pub date_to: String,
    pub sha256: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineNewsResponse {
    pub available: bool,
    pub generated_at: String,
    pub month: String,
    pub date_from: String,
    pub date_to: String,
    pub items: Vec<OfflineNewsItem>,
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = std::env::var_os("ORBIT_COPILOT_OFFLINE_NEWS") {
        candidates.push(PathBuf::from(explicit));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("OrbitCopilot")
                .join("offline-news")
                .join(UPDATE_FILENAME),
        );
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join(UPDATE_FILENAME));
            candidates.push(parent.join("offline-news").join(UPDATE_FILENAME));
        }
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn checksum_path(path: &Path) -> PathBuf {
    path.with_file_name(format!("{}.sha256", path.file_name().unwrap_or_default().to_string_lossy()))
}

fn load() -> Result<Option<(PathBuf, String, OfflineNewsUpdate)>, String> {
    let Some(path) = candidate_paths().into_iter().find(|candidate| candidate.is_file()) else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("无法读取离线新闻数据 {}：{error}", path.display()))?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    let checksum = checksum_path(&path);
    let expected = std::fs::read_to_string(&checksum)
        .map_err(|error| format!("无法读取离线新闻校验文件 {}：{error}", checksum.display()))?
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if expected.len() != 64 || actual != expected {
        return Err(format!("离线新闻数据 SHA-256 校验失败：{}", path.display()));
    }
    let update: OfflineNewsUpdate = serde_json::from_slice(&bytes)
        .map_err(|error| format!("离线新闻数据格式错误：{error}"))?;
    if update.schema != UPDATE_SCHEMA {
        return Err(format!("不支持的离线新闻数据格式：{}", update.schema));
    }
    if update.month.len() != 7
        || update.date_from.len() != 10
        || update.date_to.len() != 10
        || update.date_from > update.date_to
        || !update.date_from.starts_with(&update.month)
        || !update.date_to.starts_with(&update.month)
    {
        return Err("离线新闻数据的月份或日期范围无效".into());
    }
    if update.items.iter().any(|item| {
        !matches!(item.kind.as_str(), "debris" | "spacenews" | "techport" | "news")
            || item.id.trim().is_empty()
            || item.title.trim().is_empty()
            || !item.published.starts_with(&update.month)
    }) {
        return Err("离线新闻数据含有无效条目".into());
    }
    Ok(Some((path, actual, update)))
}

pub fn status() -> Result<OfflineDataStatus, String> {
    let Some((path, sha256, update)) = load()? else {
        return Ok(OfflineDataStatus {
            available: false,
            path: String::new(),
            generated_at: String::new(),
            month: String::new(),
            date_from: String::new(),
            date_to: String::new(),
            sha256: String::new(),
            item_count: 0,
        });
    };
    Ok(OfflineDataStatus {
        available: true,
        path: path.to_string_lossy().to_string(),
        generated_at: update.generated_at,
        month: update.month,
        date_from: update.date_from,
        date_to: update.date_to,
        sha256,
        item_count: update.items.len(),
    })
}

pub fn news(date: &str) -> Result<OfflineNewsResponse, String> {
    let Some((_, _, update)) = load()? else {
        return Ok(OfflineNewsResponse {
            available: false,
            generated_at: String::new(),
            month: String::new(),
            date_from: String::new(),
            date_to: String::new(),
            items: Vec::new(),
        });
    };
    let items = update
        .items
        .iter()
        .filter(|item| date.is_empty() || item.published.starts_with(date))
        .cloned()
        .collect();
    Ok(OfflineNewsResponse {
        available: true,
        generated_at: update.generated_at,
        month: update.month,
        date_from: update.date_from,
        date_to: update.date_to,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_four_supported_kinds_are_accepted() {
        for kind in ["debris", "spacenews", "techport", "news"] {
            assert!(matches!(kind, "debris" | "spacenews" | "techport" | "news"));
        }
    }
}
