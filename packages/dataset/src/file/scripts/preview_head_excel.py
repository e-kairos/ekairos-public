import sys
import openpyxl
import xml.etree.ElementTree as ET

file_path = sys.argv[1]
n_rows = int(sys.argv[2]) if len(sys.argv) > 2 else 10

wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
ws = wb.worksheets[0]

root = ET.Element("rows")

rows_printed = 0
for row_idx, row in enumerate(ws.iter_rows()):
    if rows_printed >= n_rows:
        break
    row_elem = ET.SubElement(root, "row", index=str(row_idx))
    
    for col_idx, cell in enumerate(row):
        cell_elem = ET.SubElement(row_elem, "cell", column=str(col_idx))
        cell_value = cell.value
        cell_elem.text = str(cell_value) if cell_value is not None else ""
    
    rows_printed += 1

tree = ET.ElementTree(root)
ET.indent(tree, space="  ")
print('<?xml version="1.0" encoding="UTF-8"?>')
print(ET.tostring(root, encoding="unicode"))

