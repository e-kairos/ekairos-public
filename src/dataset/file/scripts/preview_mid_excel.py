import sys
import random
import openpyxl
import xml.etree.ElementTree as ET

file_path = sys.argv[1]
start_row = int(sys.argv[2])
end_row = int(sys.argv[3])
n_samples = int(sys.argv[4]) if len(sys.argv) > 4 else 10

wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
ws = wb.worksheets[0]

root = ET.Element("rows")

all_rows = list(ws.iter_rows())
mid_section = all_rows[start_row:end_row]

if len(mid_section) <= n_samples:
    sampled_with_idx = [(i, row) for i, row in enumerate(mid_section)]
else:
    random.seed(42)
    indices = sorted(random.sample(range(len(mid_section)), n_samples))
    sampled_with_idx = [(i, mid_section[i]) for i in indices]

for relative_idx, row in sampled_with_idx:
    actual_idx = start_row + relative_idx
    row_elem = ET.SubElement(root, "row", index=str(actual_idx))
    
    for col_idx, cell in enumerate(row):
        cell_elem = ET.SubElement(row_elem, "cell", column=str(col_idx))
        cell_value = cell.value
        cell_elem.text = str(cell_value) if cell_value is not None else ""

tree = ET.ElementTree(root)
ET.indent(tree, space="  ")
print('<?xml version="1.0" encoding="UTF-8"?>')
print(ET.tostring(root, encoding="unicode"))

