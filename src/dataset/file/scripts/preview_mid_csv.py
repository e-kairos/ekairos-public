import sys
import csv
import random
import xml.etree.ElementTree as ET

file_path = sys.argv[1]
start_row = int(sys.argv[2])
end_row = int(sys.argv[3])
n_samples = int(sys.argv[4]) if len(sys.argv) > 4 else 10

root = ET.Element("rows")

with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
    reader = csv.reader(fh)
    all_rows = list(reader)

mid_section = all_rows[start_row:end_row]

if len(mid_section) <= n_samples:
    sampled_with_idx = [(i, row) for i, row in enumerate(mid_section)]
else:
    random.seed(42)
    sampled_with_idx = sorted(random.sample(list(enumerate(mid_section)), n_samples), key=lambda x: x[0])

for relative_idx, row_data in sampled_with_idx:
    actual_idx = start_row + relative_idx
    row_elem = ET.SubElement(root, "row", index=str(actual_idx))
    for col_idx, cell_value in enumerate(row_data):
        cell_elem = ET.SubElement(row_elem, "cell", column=str(col_idx))
        cell_elem.text = cell_value if cell_value else ""

tree = ET.ElementTree(root)
ET.indent(tree, space="  ")
print('<?xml version="1.0" encoding="UTF-8"?>')
print(ET.tostring(root, encoding="unicode"))

