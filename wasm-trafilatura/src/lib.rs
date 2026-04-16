use wasm_bindgen::prelude::*;
use trafilatura::{extract, Options};

/// Extract the main article body from raw HTML and return it as Markdown.
///
/// Called from the browser via the WASM bridge:
///   const md = wasm.extract_markdown(htmlString);
///
/// Returns an empty string if extraction fails or the page has no article body.
#[wasm_bindgen]
pub fn extract_markdown(html: &str) -> String {
    // trafilatura 0.3 supports markdown export from extraction results.
    // Keep links/images so markdown output can preserve and localize assets.
    let opts = Options::default()
        .with_images(true)
        .with_links(true)
        .with_exclude_comments(true);

    match extract(html, &opts) {
        Ok(result) => result.content_markdown(),
        Err(_) => String::new(),
    }
}
