#!/bin/python3

import sys
sys.path.insert(0,"_vendor")

import requests
import os
import re
import json
import glob
import argparse
from tqdm import tqdm
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- Constants ---
LOCAL_ROOT = "www.photopea.com/"
REMOTE_WEBSITE = "https://photopea.com/"
MAX_FONT_WORKERS = 16

# --- File Download Utilities ---

def download_file(remote_url, local_path):
    """
    Downloads a single file with a progress bar.
    Overwrites existing files.
    """
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    
    with tqdm(desc=os.path.basename(local_path), unit="B", unit_scale=True, leave=False) as progress_bar:
        try:
            r = requests.get(remote_url, stream=True, timeout=30)
            progress_bar.total = int(r.headers.get("Content-Length", 0))
            
            if r.status_code != 200:
                tqdm.write(f"ERROR: HTTP Status {r.status_code} for {os.path.basename(local_path)}")
                return
            
            with open(local_path, "wb") as outf:
                for chunk in r.iter_content(chunk_size=4096):
                    progress_bar.update(len(chunk))
                    outf.write(chunk)
        except requests.exceptions.RequestException as e:
            tqdm.write(f"ERROR downloading {os.path.basename(local_path)}: {e}")

# --- Core Application Setup ---

def download_core_files():
    """
    Downloads the main HTML, CSS, and JS files required for Photopea to run.
    It first downloads index.html, then parses it to find the names of
    dynamically generated JS and CSS files.
    Returns a dictionary of the discovered dynamic paths.
    """
    initial_urls = [
        "index.html", "manifest.json", "promo/thumb256.png", "rsrc/basic/basic.zip", "code/ext/hb.wasm",
        "code/ext/fribidi.wasm", "papi/tpls.json", "rsrc/fonts/fonts.png",
        "code/storages/deviceStorage.html", "code/storages/googledriveStorage.html",
        "code/storages/dropboxStorage.html", "img/nft.png",
        ["templates/?type=0&rsrc=", "templates/index.html"],
        "templates/templates.js", "templates/templates.css", "plugins/gallery.json",
        "plugins/gallery.html", "img/wows_logo.png", "promo/icon512.png"
    ]
    
    print("Downloading index.html...")
    index_local_path = os.path.join(LOCAL_ROOT, "index.html")
    download_file(REMOTE_WEBSITE + "index.html", index_local_path)
    
    try:
        with open(index_local_path, "r", encoding="utf-8") as f:
            index_content = f.read()
    except FileNotFoundError:
        print(f"ERROR: could not read {index_local_path}. Aborting.")
        return None

    urls_to_download = initial_urls
    dynamic_paths = {}
    regex_patterns = {
        "style": r"style/all(\d+).css", "ext": r"code/ext/ext(\d+).js",
        "dbs": r"code/dbs/DBS(\d+).js", "pp": r"code/pp/pp(\d+).js"
    }
    print("Parsing index.html for dynamic file names...")
    for name, pattern in regex_patterns.items():
        match = re.search(pattern, index_content)
        if match:
            path = match.group(0)
            urls_to_download.append(path)
            dynamic_paths[name] = path
            print(f"  Found {name}: {path}")
        else:
            print(f"  WARNING: Could not find path for '{name}'")

    print(f"\nDownloading {len(urls_to_download)} core files...")
    for path_item in tqdm(urls_to_download, desc="Core Files"):
        remote_path, local_name = path_item if isinstance(path_item, list) else (path_item, path_item)
        download_file(REMOTE_WEBSITE + remote_path, os.path.join(LOCAL_ROOT, local_name))
        
    return dynamic_paths

def parse_db(dbs_path):
    """Parses the main database JS file to extract variables like the font list."""
    db_file_path = os.path.join(LOCAL_ROOT, dbs_path)
    db = {}
    try:
        with open(db_file_path, encoding="utf-8") as f:
            db_data = f.read()
        db_vars = re.findall(r"var (\w+)\s*=\s*(\{[\w\W]+?\n\s*\})\s*(?=;|/\*|var)", db_data)
        for varname, vardata in db_vars:
            try:
                db[varname] = json.loads(vardata)
            except Exception:
                if varname == 'FNTS': print(f"Warning: Unable to parse DBS variable '{varname}'")
        print(f"Successfully parsed {len(db)} variables from {os.path.basename(dbs_path)}.")
        return db
    except Exception as e:
        print(f"Error parsing database file at {db_file_path}: {e}")
        return None

# --- Patching ---

def find_and_replace(file_path, find, replace):
    """Reads a file, performs a find-and-replace, and writes it back."""
    try:
        with open(file_path, 'r', encoding="utf-8") as f:
            content = f.read()
        
        if find not in content:
            return

        new_content = content.replace(find, replace)
        
        with open(file_path, 'w', encoding="utf-8") as f:
            f.write(new_content)
    except FileNotFoundError:
        print(f"  - ERROR: Could not find {os.path.basename(file_path)} to patch it.")
    except Exception as e:
        print(f"  - ERROR patching {os.path.basename(file_path)}: {e}")

def apply_patches(pp_path):
    """Applies all necessary modifications to the downloaded files for offline use."""
    if not pp_path:
        print("  - ERROR: Path to main 'pp.js' not provided. Cannot apply patches.")
        return

    pp_full_path = os.path.join(LOCAL_ROOT, pp_path)
    index_full_path = os.path.join(LOCAL_ROOT, 'index.html')
    dropbox_full_path = os.path.join(LOCAL_ROOT, 'code/storages/dropboxStorage.html')

    print(f"Applying patches to {os.path.basename(pp_full_path)}, index.html, and others...")
    
    #Allow any port to be used
    find_and_replace(pp_full_path, '"\'$!|"))', '"\'$!|"))||true')

    #Don't load Google Analytics
    find_and_replace(index_full_path, '//www.google-analytics.com/analytics.js', '')
    find_and_replace(index_full_path, '//www.googletagmanager.com', '#')

    #Allow the import of pictures of URLs (bypassing mirror.php)
    find_and_replace(pp_full_path, '"mirror.php?url="+encodeURIComponent', '')

    #Allow Dropbox to load from dropboxStorage.html
    find_and_replace(dropbox_full_path, 'var redirectUri = window.location.href;', 'var redirectUri = "https://www.photopea.com/code/storages/dropboxStorage.html";')

    #Remove Facebook Pixel Domains
    find_and_replace(index_full_path, 'https://connect.facebook.net', '')
    find_and_replace(index_full_path, 'https://www.facebook.com', '')

    #Redirect dynamic pages to static equivalent
    find_and_replace(pp_full_path, '"&rsrc="', '""')
    find_and_replace(pp_full_path, '"templates/?type="', '"templates/index.html?type="')
    find_and_replace(pp_full_path, '"https://f000.backblazeb2.com/file/"', '"templates/file/"')

    #Force enable Remove BG, and any other options that are disabled on self-hosted instances (much more brittle to changes than the other replacements)
    find_and_replace(pp_full_path, '("~yy")', '("~yy")||true')

    # Having ? in static sites doesn't really work
    #find_and_replace("templates/index.html",'sch.split("?");','sch.split("#");')

# --- Font Update Logic ---

@dataclass
class Font:
    ff: str; fsf: str; psn: str; flg: int; cat: int; url: str

def generate_font_manifest(db):
    """
    Parses the font list from the database and saves it to a JSON file.
    """
    if not db or "FNTS" not in db:
        print("Could not find font database. Skipping manifest generation.")
        return

    print("Generating font manifest...")
    all_fonts = []
    for font in decompress_font_list(db["FNTS"]["list"]):
        # The dataclass can be converted to a dict for JSON serialization
        all_fonts.append(font.__dict__)

    manifest_path = os.path.join(LOCAL_ROOT, "font-manifest.json")
    try:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(all_fonts, f)
        print(f"Successfully created font-manifest.json with {len(all_fonts)} fonts.")
    except Exception as e:
        print(f"ERROR: Could not write font manifest: {e}")

def decompress_font_list(flist):
    prev_ff, prev_fsf, prev_flg, prev_cat = "", "", "0", "0"
    for font_entry in flist:
        ff, fsf, psn, flg, cat, url = font_entry.split(",")
        ff = ff or prev_ff; fsf = fsf or prev_fsf; flg = flg or prev_flg; cat = cat or prev_cat
        if not psn: psn = (ff + "-" + fsf).replace(" ", "")
        elif psn == "a": psn = ff.replace(" ", "")
        if not url: url = "fs/" + psn + ".otf"
        elif url == "a": url = "gf/" + psn + ".otf"
        yield Font(ff, fsf, psn, int(flg), int(cat), url)
        prev_ff, prev_fsf, prev_flg, prev_cat = ff, fsf, flg, cat

def download_default_fonts(db):
    """Finds and downloads the default DejaVu font family."""
    if not db or "FNTS" not in db:
        print("Could not find font database. Skipping default font download.")
        return

    print("Checking for default fonts (DejaVu)...")
    dejavu_fonts = []
    for font in decompress_font_list(db["FNTS"]["list"]):
        # Find DejaVuSans and its variations like DejaVuSans-Bold, but not DejaVuSansCondensed
        if font.psn == "DejaVuSans" or font.psn.startswith("DejaVuSans-"):
            dejavu_fonts.append(font)

    for font in dejavu_fonts:
        local_path = os.path.join(LOCAL_ROOT, "rsrc/fonts", font.url)
        if not os.path.isfile(local_path):
            print(f"  Downloading missing default font: {font.psn}")
            remote_url = f"{REMOTE_WEBSITE}rsrc/fonts/{font.url}"
            download_file(remote_url, local_path)

def download_font_worker(font: Font):
    path = "rsrc/fonts/" + font.url
    remote = REMOTE_WEBSITE + path
    local = os.path.join(LOCAL_ROOT, path)
    try:
        os.makedirs(os.path.dirname(local), exist_ok=True)
        r = requests.get(remote, timeout=60)
        if r.status_code == 200:
            with open(local, "wb") as outf: outf.write(r.content)
            return (font.psn, None)
        return (font.psn, f"HTTP Error {r.status_code}")
    except Exception as e:
        return (font.psn, str(e))

def update_fonts(db):
    all_fonts_in_db = list(decompress_font_list(db["FNTS"]["list"]))
    fonts_to_download = [f for f in all_fonts_in_db if not os.path.isfile(os.path.join(LOCAL_ROOT, "rsrc/fonts/", f.url))]

    if not fonts_to_download:
        print("All fonts are up to date.")
    else:
        print(f"Found {len(fonts_to_download)} new/missing fonts. Downloading...")
        with ThreadPoolExecutor(max_workers=MAX_FONT_WORKERS) as executor:
            future_to_font = {executor.submit(download_font_worker, font): font for font in fonts_to_download}
            for future in tqdm(as_completed(future_to_font), total=len(fonts_to_download), desc="Downloading Fonts"):
                font_psn, error = future.result()
                if error:
                    tqdm.write(f"Failed to download font '{font_psn}': {error}")

# --- Template Update Logic ---

def update_templates():
    try:
        with open(os.path.join(LOCAL_ROOT, "papi/tpls.json"), "r") as f:
            templates_list = json.load(f)['list']
    except (FileNotFoundError, KeyError, json.JSONDecodeError) as e:
        print(f"Could not read or parse papi/tpls.json: {e}. Skipping template update.")
        return

    templates_db = []
    for tpl_data in templates_list:
        subdir = 'psdshared' if "imgur.com" in tpl_data[4] else 'pp-resources'
        remote_url = f"https://f000.backblazeb2.com/file/{subdir}/{tpl_data[3]}"
        local_path = os.path.join(LOCAL_ROOT, "templates/file", subdir, tpl_data[3])
        templates_db.append({'remote': remote_url, 'local': local_path})

    print(f"Checking {len(templates_db)} templates...")
    for template in tqdm(templates_db, desc="Updating Templates"):
        download_file(template['remote'], template['local'])

    print("\nChecking for unused local templates to remove...")
    templates_in_db_paths = {tpl['local'] for tpl in templates_db}
    local_template_files = {f for f in glob.glob(os.path.join(LOCAL_ROOT, 'templates/file', '**', '*.psd'), recursive=True) if os.path.isfile(f)}
    
    for tpl_file in (local_template_files - templates_in_db_paths):
        print(f"Removing unused template: {os.path.relpath(tpl_file, LOCAL_ROOT)}")
        try:
            os.remove(tpl_file)
        except OSError as e:
            print(f"  - Error removing file: {e}")

# --- Main Execution ---

def main():
    parser = argparse.ArgumentParser(description="Downloader and patcher for an offline version of Photopea.")
    parser.add_argument('--fonts', action='store_true', help='Download/update all fonts (for developers).')
    parser.add_argument('--templates', action='store_true', help='Download/update all templates.')
    args = parser.parse_args()

    print("--- Step 1: Downloading core application files ---")
    dynamic_paths = download_core_files()
    if not dynamic_paths or not all(k in dynamic_paths for k in ["pp", "dbs"]):
        print("\nCritical error: Could not find dynamic JS/CSS paths. Aborting.")
        sys.exit(1)

    print("\n--- Step 2: Parsing database file ---")
    db = parse_db(dynamic_paths["dbs"])
    if not db:
        print("\nCritical error: Could not parse database file. Aborting.")
        sys.exit(1)

    print("\n--- Step 3: Generating Font Manifest ---")
    generate_font_manifest(db)

    print("\n--- Step 4: Downloading default fonts ---")
    download_default_fonts(db)
    
    print("\n--- Step 5: Applying critical patches for offline functionality ---")
    apply_patches(pp_path=dynamic_paths["pp"])

    print("\n--- Core setup complete. Application is now functional. ---")

    if args.fonts:
        print("\n--- Updating all fonts (--fonts) ---")
        if "FNTS" in db:
            update_fonts(db)
        else:
            print("Warning: 'FNTS' data not found in DB, cannot update fonts.")

    if args.templates:
        print("\n--- Updating all templates (--templates) ---")
        update_templates()

    print("\n--- Script finished successfully! ---")


if __name__ == "__main__":
    main()