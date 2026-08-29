"""
Wealth Building Simulator PRO - Single File HTML Builder
Merges styles.css and app.js into index.html to produce a 100% self-contained single-file HTML.
This ensures CSS and JS work flawlessly when opening directly on mobile devices (Google Drive, Files app, etc.).
"""

import os
import re

def build_single_file():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    index_path = os.path.join(base_dir, 'index.html')
    css_path = os.path.join(base_dir, 'styles.css')
    js_path = os.path.join(base_dir, 'app.js')

    with open(css_path, 'r', encoding='utf-8') as f:
        css_content = f.read()

    with open(js_path, 'r', encoding='utf-8') as f:
        js_content = f.read()

    with open(index_path, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # If index.html already has inline style/script or external links:
    # 1. Replace <link rel="stylesheet" href="styles.css"> or existing <style id="inline-styles">...</style>
    if '<link rel="stylesheet" href="styles.css">' in html_content:
        style_tag = f"<style id=\"inline-styles\">\n{css_content}\n  </style>"
        html_content = html_content.replace('<link rel="stylesheet" href="styles.css">', style_tag)
    elif '<style id="inline-styles">' in html_content:
        html_content = re.sub(r'<style id="inline-styles">[\s\S]*?</style>', f'<style id="inline-styles">\n{css_content}\n  </style>', html_content)

    # 2. Replace <script src="app.js"></script> or existing <script id="inline-app">...</script>
    if '<script src="app.js"></script>' in html_content:
        script_tag = f"<script id=\"inline-app\">\n{js_content}\n  </script>"
        html_content = html_content.replace('<script src="app.js"></script>', script_tag)
    elif '<script id="inline-app">' in html_content:
        html_content = re.sub(r'<script id="inline-app">[\s\S]*?</script>', f'<script id="inline-app">\n{js_content}\n  </script>', html_content)

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"Successfully generated single-file index.html ({len(html_content)} bytes)")

if __name__ == '__main__':
    build_single_file()
