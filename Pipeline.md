1. Read all TXT files from ./authors/
    a. file names are institutes
    b. names in each row are authors
    c. authors can belong to multiple institutes

2. Create a JSON file that maps each author to their respective institutes. The structure should be as follows:
   {
       "author_name": ["institute1", "institute2", ...],
       ...
   }

3. For each author construct these links (sensitive to ąčęėįšųūž)
    "https://elaba.mb.vu.lt/mif/?aut=Name Surname"
    "https://elaba.mb.vu.lt/dmsti/?aut=Name Surname"
    "https://elaba.mb.vu.lt/mii/?aut=Name Surname"
    
4. From all links, extract all unique publications to txt plaintext as lines, like this:
    <author id="235459325">Štikonienė, Olga</author>; <author id="235458441">Štikonas, Artūras</author>; <author id="235459327">Bakhit, Abdalaziz Elhaj  Elkhwad</author>. Finite-difference scheme for two-dimensional Poisson equation with the multiple integral boundary condition // 28th international conference Mathematical modelling and analysis, May 26--29, 2025, Druskininkai, Lithuania : abstracts. Vilnius : Vilniaus Gedimino technikos universitetas, 2025. eISBN 9786094764226. eISSN 2351-5740. p. 27. DOI: <a target="_blank" href="https://doi.org/10.3846/mma.2025-043-K">10.3846/mma.2025-043-K</a>.

5. Create a similarity matrix for all authors
    for each publication: for each possible pair of authors, increment their similarity score by 1 divided by coauthors count in that publication
    Note: authors from the original collection only. Not all scraped ones will have been included.
    The ones that don't have coauthors should just be stripped away from the final matrix

6. Visualize using ForceGraph3D:
    a. Nodes represent authors, have labels
    b. Nodes are colored based on first institute TODO: find out if nodes can have multiple colors