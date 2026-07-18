"""
Sweep.net full site scraper — saves raw HTML + extracted text for every page in the sitemap.
Personal/research use only.
"""

import os
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.sweep.net"
SITEMAP_URL = "https://www.sweep.net/sitemap-0.xml"
OUT_DIR = Path(r"C:\Users\Ambro2\sweep-scrape\pages")
HTML_DIR = OUT_DIR / "html"
TEXT_DIR = OUT_DIR / "text"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
DELAY = 1.5  # seconds between requests — be polite


def fetch_sitemap_urls(sitemap_url: str) -> list[str]:
    resp = requests.get(sitemap_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [loc.text.strip() for loc in root.findall(".//sm:loc", ns) if loc.text]
    return urls


def url_to_filename(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    if not path:
        path = "_index"
    path = re.sub(r"[^a-zA-Z0-9_/\-]", "_", path)
    path = path.replace("/", "__")
    return path[:200]


def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()

    # Extract meta info
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    meta_desc = ""
    meta_tag = soup.find("meta", attrs={"name": "description"})
    if meta_tag and meta_tag.get("content"):
        meta_desc = meta_tag["content"].strip()

    # Extract all links
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if text and href:
            links.append(f"  [{text}]({href})")

    # Extract images
    images = []
    for img in soup.find_all("img"):
        src = img.get("src", img.get("data-src", ""))
        alt = img.get("alt", "")
        if src:
            images.append(f"  ![{alt}]({src})")

    # Main text
    body = soup.find("main") or soup.find("body") or soup
    text = body.get_text(separator="\n", strip=True)

    sections = [f"# {title}\n"]
    if meta_desc:
        sections.append(f"**Description:** {meta_desc}\n")
    sections.append("## Content\n")
    sections.append(text)
    if links:
        sections.append("\n## Links\n")
        sections.append("\n".join(links[:500]))
    if images:
        sections.append("\n## Images\n")
        sections.append("\n".join(images[:200]))

    return "\n\n".join(sections)


def extract_source_code(html: str) -> dict:
    """Extract inline scripts, styles, structured data, and other technical elements."""
    soup = BeautifulSoup(html, "html.parser")
    result = {}

    # Inline scripts
    scripts = []
    for s in soup.find_all("script"):
        src = s.get("src", "")
        content = s.string or ""
        scripts.append({"src": src, "type": s.get("type", ""), "inline": content[:5000]})
    result["scripts"] = scripts

    # Inline styles
    styles = []
    for s in soup.find_all("style"):
        styles.append(s.string[:5000] if s.string else "")
    result["styles"] = styles

    # Structured data (JSON-LD)
    json_ld = []
    for s in soup.find_all("script", type="application/ld+json"):
        if s.string:
            json_ld.append(s.string.strip())
    result["json_ld"] = json_ld

    # Meta tags
    metas = {}
    for m in soup.find_all("meta"):
        name = m.get("name") or m.get("property") or m.get("http-equiv", "")
        content = m.get("content", "")
        if name and content:
            metas[name] = content
    result["meta_tags"] = metas

    # Link tags (stylesheets, preloads, etc.)
    link_tags = []
    for l in soup.find_all("link"):
        link_tags.append({k: v for k, v in l.attrs.items()})
    result["link_tags"] = link_tags

    return result


def main():
    HTML_DIR.mkdir(parents=True, exist_ok=True)
    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    code_dir = OUT_DIR / "code"
    code_dir.mkdir(parents=True, exist_ok=True)

    print("Fetching sitemap...")
    urls = fetch_sitemap_urls(SITEMAP_URL)
    # Filter to English pages only (skip /fr/ and /de/ duplicates unless you want them)
    en_urls = [u for u in urls if "/fr/" not in u and "/de/" not in u]
    all_urls = en_urls  # Change to `urls` if you want all languages

    print(f"Found {len(urls)} total URLs, {len(en_urls)} English. Scraping {len(all_urls)}...")

    results = {"ok": 0, "fail": 0, "errors": []}

    for i, url in enumerate(all_urls):
        fname = url_to_filename(url)
        html_path = HTML_DIR / f"{fname}.html"
        text_path = TEXT_DIR / f"{fname}.md"
        code_path = code_dir / f"{fname}.json"

        if html_path.exists():
            print(f"[{i+1}/{len(all_urls)}] SKIP (exists): {url}")
            results["ok"] += 1
            continue

        print(f"[{i+1}/{len(all_urls)}] Fetching: {url}")
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            html = resp.text

            # Save raw HTML
            html_path.write_text(html, encoding="utf-8")

            # Save extracted text
            text = extract_text(html)
            text_path.write_text(text, encoding="utf-8")

            # Save code/technical elements
            import json
            code_data = extract_source_code(html)
            code_path.write_text(json.dumps(code_data, indent=2, ensure_ascii=False), encoding="utf-8")

            results["ok"] += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            results["fail"] += 1
            results["errors"].append({"url": url, "error": str(e)})

        time.sleep(DELAY)

    # Write summary
    import json
    summary = {
        "total_urls": len(all_urls),
        "ok": results["ok"],
        "fail": results["fail"],
        "errors": results["errors"],
        "urls": all_urls,
    }
    (OUT_DIR / "scrape_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nDone! OK: {results['ok']}, Failed: {results['fail']}")
    print(f"Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
