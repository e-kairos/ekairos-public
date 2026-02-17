import sys
import csv
import xml.etree.ElementTree as ET

file_path = sys.argv[1]
n_rows = int(sys.argv[2]) if len(sys.argv) > 2 else 10

root = ET.Element("rows")

with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
    reader = csv.reader(fh)
    for row_idx, row_data in enumerate(reader):
        if row_idx >= n_rows:
            break
        row_elem = ET.SubElement(root, "row", index=str(row_idx))
        for col_idx, cell_value in enumerate(row_data):
            cell_elem = ET.SubElement(row_elem, "cell", column=str(col_idx))
            cell_elem.text = cell_value if cell_value else ""

tree = ET.ElementTree(root)
ET.indent(tree, space="  ")
print('<?xml version="1.0" encoding="UTF-8"?>')
print(ET.tostring(root, encoding="unicode"))

