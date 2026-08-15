import os
import re
import json
import time
import urllib.request
import urllib.parse
import hashlib
import sys
from collections import defaultdict

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

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
            
    # Safely url-encode non-ascii characters before fetching
    try:
        parsed = urllib.parse.urlparse(url)
        encoded_path = urllib.parse.quote(parsed.path)
        encoded_query = urllib.parse.quote(parsed.query, safe='=&+')
        safe_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, encoded_path, parsed.params, encoded_query, parsed.fragment))
    except Exception:
        safe_url = url

    print(f"Fetching from network: {safe_url}")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    req = urllib.request.Request(safe_url, headers=headers)
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
    print("--- STEP 1: Parse Authors and Faculties recursively from VU_darbuotojai.json ---")
    json_path = os.path.join("authors", "VU_darbuotojai.json")
    
    if not os.path.exists(json_path):
        print(f"Error: Could not find {json_path}!")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Sets are used to enforce uniqueness of faculties per author:
    # "however if it appears in multiple divisions of a single faculty, dont let that affect the ratio of colors."
    author_to_institutes = defaultdict(set)
    author_to_elaba = {}
    author_to_pareigos = defaultdict(list)
    original_authors_set = set()

    def traverse(padalinys, current_faculty=None):
        lygis = padalinys.get("lygis")
        pavadinimas = padalinys.get("pavadinimas")
        
        # If level is 1, this is the faculty (e.g. Matematikos ir informatikos fakultetas)
        if lygis == 1:
            current_faculty = pavadinimas
            
        for d in padalinys.get("darbuotojai", []):
            name = d.get("vardas_pavarde")
            elaba = d.get("elaba")
            pareigos = d.get("pareigos")
            
            if name:
                normalized_name = " ".join(name.strip().split())
                original_authors_set.add(normalized_name)
                
                if elaba:
                    author_to_elaba[normalized_name] = elaba.strip()
                    
                if current_faculty:
                    author_to_institutes[normalized_name].add(current_faculty)
                    
                # requirement: "in the info about author add a list of "pareigos" departments for each occurence (in any subdivision no matter the level)"
                pos_str = f"{pareigos} ({pavadinimas})" if pareigos else pavadinimas
                if pos_str not in author_to_pareigos[normalized_name]:
                    author_to_pareigos[normalized_name].append(pos_str)
                    
        for sub in padalinys.get("padaliniai", []):
            traverse(sub, current_faculty)

    for p in data.get("padaliniai", []):
        traverse(p)

    # Convert sets to sorted lists for json serialization and consistent order
    author_to_institutes_list = {
        name: sorted(list(facs)) for name, facs in author_to_institutes.items()
    }

    print(f"Found {len(original_authors_set)} unique authors across VU faculties.")
    
    print("\n--- STEP 2: Save author_institutes.json ---")
    with open("author_institutes.json", "w", encoding="utf-8") as f:
        json.dump(author_to_institutes_list, f, indent=4, ensure_ascii=False)
    print("Exported author_institutes.json")

    print("\n--- STEP 3 & 4: Fetch and Parse Publications ---")
    unique_publications = {}  # key: cleaned pub HTML content, value: publication string
    author_publication_counts = defaultdict(int)
    author_seen_pubs = defaultdict(set)
    
    for author in sorted(original_authors_set):
        url = author_to_elaba.get(author)
        if not url:
            continue
            
        # Parse subcatalog from URL to be fully compatible with existing .cache hashing
        try:
            parts = url.split('/')
            subcat = parts[-2] if len(parts) >= 2 else "fsf"
        except Exception:
            subcat = "fsf"
            
        cache_path = get_cache_filename(author, subcat)
        html_content = fetch_url(url, cache_path, delay=0.1)
        if not html_content:
            continue
            
        # Regex to find each <tr><td>Eil. Nr.</td><td>...</td></tr>
        matches = re.finditer(
            r'<tr>\s*<td>\d+</td>\s*<td>(.*?)</td>\s*</tr>', 
            html_content, 
            re.DOTALL | re.IGNORECASE
        )
        
        for match in matches:
            pub_html = match.group(1).strip()
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

    # Re-calculate author publication counts based on all unique publications in our dataset
    # This ensures consistency and catches co-authored publications
    author_publication_counts = defaultdict(int)
    for cleaned_pub in unique_publications.keys():
        author_matches = re.findall(r'<author[^>]*>([^<]+)</author>', cleaned_pub)
        seen_in_pub = set()
        for am in author_matches:
            normalized = normalize_scraped_name(am)
            if normalized in original_authors_set and normalized not in seen_in_pub:
                seen_in_pub.add(normalized)
                author_publication_counts[normalized] += 1

    # Format data for ForceGraph3D
    # Only include authors who have at least 1 publication in the dataset
    nodes = []
    for author in sorted(original_authors_set):
        val = author_publication_counts[author]
        if val > 0:
            nodes.append({
                "id": author,
                "name": author,
                "institutes": author_to_institutes_list.get(author, []),
                "pareigos": author_to_pareigos.get(author, []),
                "val": val
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
