import os
import re
import json
import time
import urllib.request
import urllib.parse
import hashlib
from collections import defaultdict

def safe_filename(name):
    """Generates a clean and safe filename suffix based on the author name."""
    return re.sub(r'[^a-zA-Z0-9]', '_', name)

def get_cache_filename(author_name, subcatalog):
    """Returns a unique hashed file path for caching queries."""
    key = f"{author_name}_{subcatalog}".encode('utf-8')
    md5_hash = hashlib.md5(key).hexdigest()
    # Combine first few safe characters of the name and md5 for easy debugging
    safe_name = safe_filename(author_name)[:15]
    return os.path.join(".cache", f"{safe_name}_{subcatalog}_{md5_hash}.html")

def fetch_url(url, cache_path, delay=0.2):
    """Fetches a URL and caches it. Sleep for `delay` if fetching from network."""
    os.makedirs(".cache", exist_ok=True)
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read()
            
    print(f"Fetching from network: {url}")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            content = response.read().decode('utf-8')
            with open(cache_path, "w", encoding="utf-8") as f:
                f.write(content)
            time.sleep(delay)
            return content
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return ""

def normalize_scraped_name(name):
    """Normalizes 'Lastname, Firstname' format to 'Firstname Lastname'."""
    name = name.strip()
    if ',' in name:
        parts = name.split(',', 1)
        lastname = parts[0].strip()
        firstname = parts[1].strip()
        name = f"{firstname} {lastname}"
    return " ".join(name.split())

def main():
    print("--- STEP 1: Parse Authors and Institutes ---")
    authors_dir = "./authors"
    author_to_institutes = defaultdict(list)
    original_authors_set = set()
    
    # List and parse files
    files = [f for f in os.listdir(authors_dir) if f.endswith(".txt")]
    for filename in files:
        institute_name = os.path.splitext(filename)[0]
        filepath = os.path.join(authors_dir, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                name = " ".join(line.strip().split())
                if name:
                    author_to_institutes[name].append(institute_name)
                    original_authors_set.add(name)
                    
    print(f"Found {len(original_authors_set)} unique authors across {len(files)} institutes.")
    
    print("\n--- STEP 2: Save author_institutes.json ---")
    with open("author_institutes.json", "w", encoding="utf-8") as f:
        json.dump(author_to_institutes, f, indent=4, ensure_ascii=False)
    print("Exported author_institutes.json")

    print("\n--- STEP 3 & 4: Fetch and Parse Publications ---")
    subcatalogs = ["mif", "dmsti", "mii"]
    unique_publications = {}  # key: cleaned pub HTML content, value: publication string
    author_publication_counts = defaultdict(int)
    author_seen_pubs = defaultdict(set)
    
    for author in sorted(original_authors_set):
        encoded_author = urllib.parse.quote(author)
        for subcat in subcatalogs:
            url = f"https://elaba.mb.vu.lt/{subcat}/?aut={encoded_author}"
            cache_path = get_cache_filename(author, subcat)
            html_content = fetch_url(url, cache_path, delay=0.1)
            if not html_content:
                continue
                
            # Regex to find each <tr><td>Eil. Nr.</td><td>...</td></tr>
            # It matches numbers and then catches everything until the closing </td></tr>
            matches = re.finditer(
                r'<tr>\s*<td>\d+</td>\s*<td>(.*?)</td>\s*</tr>', 
                html_content, 
                re.DOTALL | re.IGNORECASE
            )
            
            for match in matches:
                pub_html = match.group(1).strip()
                # Clean up any inner HTML whitespace/newlines to stabilize keys
                cleaned_key = " ".join(pub_html.split())
                if cleaned_key not in unique_publications:
                    unique_publications[cleaned_key] = pub_html
                if cleaned_key not in author_seen_pubs[author]:
                    author_seen_pubs[author].add(cleaned_key)
                    author_publication_counts[author] += 1
                
    print(f"Extracted {len(unique_publications)} unique publications total.")

    print("\n--- STEP 4b: Save publications.txt ---")
    with open("publications.txt", "w", encoding="utf-8") as f:
        for pub_html in unique_publications.values():
            f.write(pub_html + "\n")
    print("Exported publications.txt")

    print("\n--- STEP 5: Construct Co-Authorship Similarity Matrix ---")
    # We will build a similarity matrix for the original authors
    similarity = defaultdict(lambda: defaultdict(float))
    
    for cleaned_pub in unique_publications.keys():
        # Find all author names inside the author tags
        author_matches = re.findall(r'<author[^>]*>([^<]+)</author>', cleaned_pub)
        coauthor_count = len(author_matches)
        if coauthor_count == 0:
            continue
            
        # Match against our original author list
        matched_original_authors = []
        for am in author_matches:
            normalized = normalize_scraped_name(am)
            if normalized in original_authors_set:
                matched_original_authors.append(normalized)
                
        # For each pair, increment similarity
        increment = 1.0 / coauthor_count
        for i in range(len(matched_original_authors)):
            for j in range(i + 1, len(matched_original_authors)):
                a1 = matched_original_authors[i]
                a2 = matched_original_authors[j]
                similarity[a1][a2] += increment
                similarity[a2][a1] += increment

    # Determine connected authors (non-singletons)
    connected_authors = set()
    for author in similarity:
        # Check if they have at least one non-zero coauthor connection
        has_connections = False
        for coauthor, score in similarity[author].items():
            if score > 0:
                has_connections = True
                break
        if has_connections:
            connected_authors.add(author)
            
    print(f"{len(connected_authors)} out of {len(original_authors_set)} authors have co-authorship connections in this dataset.")
    print(f"Stripping {len(original_authors_set) - len(connected_authors)} disconnected singletons from the final visualizer.")

    # Format data for ForceGraph3D
    nodes = []
    for author in sorted(original_authors_set):
        nodes.append({
            "id": author,
            "name": author,
            "institutes": author_to_institutes[author],
            "val": author_publication_counts[author]
        })
        
    links = []
    exported_pairs = set()
    for a1 in sorted(original_authors_set):
        for a2, score in similarity[a1].items():
            if score > 0:
                # Store single undirected link by sorting keys
                pair_key = tuple(sorted([a1, a2]))
                if pair_key not in exported_pairs:
                    exported_pairs.add(pair_key)
                    links.append({
                        "source": a1,
                        "target": a2,
                        "value": round(score, 4)
                    })

    network_data = {
        "nodes": nodes,
        "links": links
    }

    with open("network_data.json", "w", encoding="utf-8") as f:
        json.dump(network_data, f, indent=4, ensure_ascii=False)
    print("Exported network_data.json")
    print("Pipeline compilation completed successfully!")

if __name__ == "__main__":
    main()
