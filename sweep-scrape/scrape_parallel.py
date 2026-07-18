"""
Sweep.net parallel scraper — uses ThreadPoolExecutor for concurrent downloads.
Skips already-downloaded pages. Personal/research use only.
"""

import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.sweep.net"
SITEMAP_URL = "https://www.sweep.net/sitemap-0.xml"
OUT_DIR = Path(r"C:\Users\Ambro2\sweep-scrape\pages")
HTML_DIR = OUT_DIR / "html"
TEXT_DIR = OUT_DIR / "text"
CODE_DIR = OUT_DIR / "code"
WORKERS = 8
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_sitemap_urls(sitemap_url):
    resp = requests.get(sitemap_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    return [loc.text.strip() for loc in root.findall(".//sm:loc", ns) if loc.text]


def url_to_filename(url):
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    if not path:
        path = "_index"
    path = re.sub(r"[^a-zA-Z0-9_/\-]", "_", path)
    path = path.replace("/", "__")
    return path[:200]


def extract_text(html):
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    meta_desc = ""
    meta_tag = soup.find("meta", attrs={"name": "description"})
    if meta_tag and meta_tag.get("content"):
        meta_desc = meta_tag["content"].strip()
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if text and href:
            links.append(f"  [{text}]({href})")
    images = []
    for img in soup.find_all("img"):
        src = img.get("src", img.get("data-src", ""))
        alt = img.get("alt", "")
        if src:
            images.append(f"  ![{alt}]({src})")
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


def extract_code(html):
    soup = BeautifulSoup(html, "html.parser")
    scripts = []
    for s in soup.find_all("script"):
        scripts.append({"src": s.get("src", ""), "type": s.get("type", ""), "inline": (s.string or "")[:5000]})
    styles = [s.string[:5000] if s.string else "" for s in soup.find_all("style")]
    json_ld = [s.string.strip() for s in soup.find_all("script", type="application/ld+json") if s.string]
    metas = {}
    for m in soup.find_all("meta"):
        name = m.get("name") or m.get("property") or m.get("http-equiv", "")
        content = m.get("content", "")
        if name and content:
            metas[name] = content
    link_tags = [{k: v for k, v in l.attrs.items()} for l in soup.find_all("link")]
    return {"scripts": scripts, "styles": styles, "json_ld": json_ld, "meta_tags": metas, "link_tags": link_tags}


def scrape_one(url):
    fname = url_to_filename(url)
    html_path = HTML_DIR / f"{fname}.html"
    text_path = TEXT_DIR / f"{fname}.md"
    code_path = CODE_DIR / f"{fname}.json"
    if html_path.exists():
        return ("skip", url, None)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        html = resp.text
        html_path.write_text(html, encoding="utf-8")
        text_path.write_text(extract_text(html), encoding="utf-8")
        code_path.write_text(json.dumps(extract_code(html), indent=2, ensure_ascii=False), encoding="utf-8")
        return ("ok", url, None)
    except Exception as e:
        return ("fail", url, str(e))


def main():
    for d in [HTML_DIR, TEXT_DIR, CODE_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    print("Fetching sitemap...", flush=True)
    urls = fetch_sitemap_urls(SITEMAP_URL)
    print(f"Found {len(urls)} URLs in sitemap.", flush=True)

    ok = skip = fail = 0
    errors = []

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(scrape_one, u): u for u in urls}
        for i, fut in enumerate(as_completed(futures), 1):
            status, url, err = fut.result()
            if status == "ok":
                ok += 1
                print(f"[{i}/{len(urls)}] OK: {url}", flush=True)
            elif status == "skip":
                skip += 1
            else:
                fail += 1
                errors.append({"url": url, "error": err})
                print(f"[{i}/{len(urls)}] FAIL: {url} — {err}", flush=True)

            if i % 50 == 0:
                print(f"  Progress: {ok} new, {skip} skipped, {fail} failed of {i} processed", flush=True)

    summary = {"total": len(urls), "new": ok, "skipped": skip, "failed": fail, "errors": errors, "urls": urls}
    (OUT_DIR / "scrape_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDONE — New: {ok}, Skipped: {skip}, Failed: {fail}, Total: {len(urls)}", flush=True)


if __name__ == "__main__":
    main()
