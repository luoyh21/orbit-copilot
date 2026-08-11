use std::collections::HashMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::{Client, Method};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, XlsxError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CREDENTIAL_SERVICE: &str = "com.starmad.orbitcopilot";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<Value>,
    #[serde(default)]
    allow_invalid_certs: bool,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
}

#[derive(Debug, Serialize)]
struct NativeResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpreadsheetColumn {
    key: String,
    label: String,
    #[serde(default)]
    r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpreadsheetExport {
    filename: String,
    title: String,
    columns: Vec<SpreadsheetColumn>,
    rows: Vec<HashMap<String, Value>>,
    generated_at: u64,
}

#[derive(Debug, Serialize)]
struct SpreadsheetSaveResult {
    saved: bool,
    path: Option<String>,
}

fn default_timeout() -> u64 {
    30
}

fn safe_spreadsheet_text(value: &str) -> String {
    if value.starts_with(['=', '+', '-', '@']) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

fn display_width(value: &str) -> usize {
    value.chars().map(|character| if character.is_ascii() { 1 } else { 2 }).sum()
}

fn build_xlsx(export: &SpreadsheetExport) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let title_format = Format::new()
        .set_bold()
        .set_font_size(16)
        .set_font_color(Color::White)
        .set_background_color("173C3D")
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    let meta_format = Format::new().set_font_color("667788").set_font_size(9);
    let header_format = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color("24585A")
        .set_border(FormatBorder::Thin)
        .set_border_color("3D7375")
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let text_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_border_color("D5DEE3")
        .set_align(FormatAlign::VerticalCenter);
    let number_format = text_format.clone().set_num_format("0.########");
    let bool_format = text_format.clone().set_align(FormatAlign::Center);

    {
        let worksheet = workbook.add_worksheet().set_name("查询结果")?;
        let last_col = export.columns.len().saturating_sub(1) as u16;
        let title_last_col = last_col.min(7);
        worksheet.set_row_height(0, 28)?;
        if title_last_col > 0 {
            worksheet.merge_range(0, 0, 0, title_last_col, &safe_spreadsheet_text(&export.title), &title_format)?;
        } else {
            worksheet.write_string_with_format(0, 0, &safe_spreadsheet_text(&export.title), &title_format)?;
        }
        let generated_at = DateTime::<Utc>::from_timestamp_millis(export.generated_at as i64)
            .map(|value| value.format("%Y-%m-%d %H:%M:%S UTC").to_string())
            .unwrap_or_else(|| "未知".to_string());
        worksheet.write_string_with_format(
            1,
            0,
            format!("由 Orbit Copilot 导出 · {} 行 · 生成时间 {generated_at}", export.rows.len()),
            &meta_format,
        )?;
        worksheet.set_row_height(3, 25)?;
        for (index, column) in export.columns.iter().enumerate() {
            let col = index as u16;
            worksheet.write_string_with_format(3, col, &safe_spreadsheet_text(&column.label), &header_format)?;
            let max_width = export.rows.iter().take(250).fold(display_width(&column.label), |width, row| {
                let value = row.get(&column.key).map(|item| match item {
                    Value::Null => String::new(),
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                }).unwrap_or_default();
                width.max(display_width(&value))
            });
            worksheet.set_column_width(col, (max_width as f64 + 2.0).clamp(10.0, 36.0))?;
        }

        for (row_index, row) in export.rows.iter().enumerate() {
            let excel_row = row_index as u32 + 4;
            for (column_index, column) in export.columns.iter().enumerate() {
                let excel_col = column_index as u16;
                match row.get(&column.key).unwrap_or(&Value::Null) {
                    Value::Null => { worksheet.write_blank(excel_row, excel_col, &text_format)?; }
                    Value::Number(number) if column.r#type.as_deref() != Some("text") => {
                        if let Some(value) = number.as_f64() {
                            worksheet.write_number_with_format(excel_row, excel_col, value, &number_format)?;
                        } else {
                            worksheet.write_string_with_format(excel_row, excel_col, number.to_string(), &text_format)?;
                        }
                    }
                    Value::Bool(value) if column.r#type.as_deref() != Some("text") => {
                        worksheet.write_boolean_with_format(excel_row, excel_col, *value, &bool_format)?;
                    }
                    Value::String(value) => {
                        worksheet.write_string_with_format(excel_row, excel_col, safe_spreadsheet_text(value), &text_format)?;
                    }
                    value => {
                        worksheet.write_string_with_format(excel_row, excel_col, safe_spreadsheet_text(&value.to_string()), &text_format)?;
                    }
                }
            }
        }
        worksheet.set_freeze_panes(4, 0)?;
        if !export.rows.is_empty() {
            worksheet.autofilter(3, 0, export.rows.len() as u32 + 3, last_col)?;
        }
    }

    {
        let notes = workbook.add_worksheet().set_name("导出说明")?;
        notes.set_column_width(0, 22)?;
        notes.set_column_width(1, 70)?;
        notes.write_string_with_format(0, 0, "项目", &header_format)?;
        notes.write_string_with_format(0, 1, "说明", &header_format)?;
        notes.write_string_with_format(1, 0, "文件标题", &text_format)?;
        notes.write_string_with_format(1, 1, &safe_spreadsheet_text(&export.title), &text_format)?;
        notes.write_string_with_format(2, 0, "数据口径", &text_format)?;
        notes.write_string_with_format(2, 1, "表格行来自本次对话中实际成功返回的 API 查询结果；空值保持为空。", &text_format)?;
        notes.write_string_with_format(3, 0, "安全处理", &text_format)?;
        notes.write_string_with_format(3, 1, "以 =、+、-、@ 开头的文本已按文本写入，避免被 Excel 当作公式执行。", &text_format)?;
    }

    workbook.save_to_buffer()
}

#[tauri::command]
async fn save_xlsx(export: SpreadsheetExport) -> Result<SpreadsheetSaveResult, String> {
    let mut filename = export.filename.trim().to_string();
    if !filename.to_ascii_lowercase().ends_with(".xlsx") {
        filename.push_str(".xlsx");
    }
    let file = rfd::AsyncFileDialog::new()
        .set_title("另存为 Excel 工作簿")
        .set_file_name(filename)
        .add_filter("Excel 工作簿", &["xlsx"])
        .save_file()
        .await;
    let Some(file) = file else {
        return Ok(SpreadsheetSaveResult { saved: false, path: None });
    };
    let bytes = build_xlsx(&export).map_err(|error| format!("生成 Excel 文件失败: {error}"))?;
    file.write(&bytes).await.map_err(|error| format!("保存 Excel 文件失败: {error}"))?;
    Ok(SpreadsheetSaveResult {
        saved: true,
        path: Some(file.path().to_string_lossy().to_string()),
    })
}

#[tauri::command]
async fn native_request(request: NativeRequest) -> Result<NativeResponse, String> {
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|error| format!("无效 HTTP 方法: {error}"))?;
    let client = Client::builder()
        .danger_accept_invalid_certs(request.allow_invalid_certs)
        .timeout(Duration::from_secs(request.timeout_seconds.clamp(1, 180)))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("无法初始化网络客户端: {error}"))?;
    let mut outbound = client.request(method, &request.url);
    for (name, value) in request.headers {
        outbound = outbound.header(&name, &value);
    }
    if let Some(body) = request.body {
        outbound = outbound.json(&body);
    }
    let response = outbound
        .send()
        .await
        .map_err(|error| format!("连接失败: {error}"))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败: {error}"))?;
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()));
    Ok(NativeResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
fn save_secret(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| format!("无法打开系统凭据库: {error}"))?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry
        .set_password(&value)
        .map_err(|error| format!("无法保存系统凭据: {error}"))
}

#[tauri::command]
fn load_secret(key: String) -> Result<String, String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| format!("无法打开系统凭据库: {error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(format!("无法读取系统凭据: {error}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            native_request,
            save_secret,
            load_secret,
            save_xlsx
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Orbit Copilot");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_real_xlsx_archive() {
        let export = SpreadsheetExport {
            filename: "test.xlsx".into(),
            title: "600–800 km 太阳同步轨道卫星".into(),
            columns: vec![
                SpreadsheetColumn { key: "name".into(), label: "名称".into(), r#type: Some("text".into()) },
                SpreadsheetColumn { key: "altitude".into(), label: "平均高度(km)".into(), r#type: Some("number".into()) },
            ],
            rows: vec![HashMap::from([
                ("name".into(), Value::String("TEST-SAT".into())),
                ("altitude".into(), Value::from(700.5)),
            ])],
            generated_at: 1_786_387_200_000,
        };
        let bytes = build_xlsx(&export).expect("xlsx should build");
        assert!(bytes.starts_with(b"PK"));
        assert!(bytes.len() > 1_000);
    }

    #[test]
    fn neutralizes_formula_like_text() {
        assert_eq!(safe_spreadsheet_text("=WEBSERVICE(\"x\")"), "'=WEBSERVICE(\"x\")");
        assert_eq!(safe_spreadsheet_text("satellite"), "satellite");
    }
}
