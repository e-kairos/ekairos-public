import sys
import openpyxl
import xml.etree.ElementTree as ET

file_path = sys.argv[1]
n_rows = int(sys.argv[2]) if len(sys.argv) > 2 else 10

wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
ws = wb.worksheets[0]

root = ET.Element("rows")

all_rows = list(ws.iter_rows())
tail_rows = all_rows[-n_rows:] if len(all_rows) > n_rows else all_rows
start_index = len(all_rows) - len(tail_rows)

for idx, row in enumerate(tail_rows):
    row_elem = ET.SubElement(root, "row", index=str(start_index + idx))
    
    for col_idx, cell in enumerate(row):
        cell_elem = ET.SubElement(row_elem, "cell", column=str(col_idx))
        cell_value = cell.value
        cell_elem.text = str(cell_value) if cell_value is not None else ""

tree = ET.ElementTree(root)
ET.indent(tree, space="  ")
print('<?xml version="1.0" encoding="UTF-8"?>')
print(ET.tostring(root, encoding="unicode"))

