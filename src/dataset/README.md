# Dataset Agent - Simplified Architecture

## ✅ Implementation Summary

La herramienta `analyzeFile` procesa archivos CSV/XLSX directamente con Python en Vercel Sandbox, **sin agentes anidados**.

## Architecture

```
DatasetAgent
  └─ analyzeFile tool
      ├─ AI genera Python script
      ├─ Script se ejecuta en sandbox compartido
      ├─ Lee CSV/XLSX
      ├─ Genera schema
      ├─ Convierte a JSON
      └─ Guarda /vercel/sandbox/dataset-{fileId}.json
```

## Test Results ✅

```bash
✓ processes CSV file with Python script (9.1s)
  - 15 rows processed
  - Schema: supplier, product, price, quantity, delivery_days, category
  - Types detected: string, number
  - Preview generated
  
✓ returns cached dataset if file already processed (9.0s)
  - First call: processes file
  - Second call: uses cached dataset
  
✓ handles Python script errors gracefully (8.0s)
  - Error captured and reported
```

## Python en Vercel Sandbox

### Runtime Disponible
- **Python**: 3.13
- **Package managers**: `pip`, `uv`
- **Sudo**: Disponible
- **Working dir**: `/vercel/sandbox`

### Bibliotecas Disponibles

#### Siempre disponibles (stdlib):
- `csv` - CSV reading/writing
- `json` - JSON manipulation
- `os` - File system operations
- `sys` - System operations
- `datetime` - Date/time handling
- `subprocess` - Process execution

#### Instalables via pip:
```python
import subprocess
import sys

# Pandas (para procesamiento avanzado)
subprocess.run([sys.executable, '-m', 'pip', 'install', 'pandas', '--quiet'], check=True)

# OpenPyXL (para Excel)
subprocess.run([sys.executable, '-m', 'pip', 'install', 'openpyxl', '--quiet'], check=True)
```

## Tool Description

El tool `analyzeFile` informa al AI sobre las capacidades:

```typescript
description: `Analyze CSV or XLSX file...

IMPORTANT: Python script can install packages if needed using pip:
- For pandas: subprocess.run([sys.executable, '-m', 'pip', 'install', 'pandas', '--quiet'], check=True)
- For openpyxl (Excel): subprocess.run([sys.executable, '-m', 'pip', 'install', 'openpyxl', '--quiet'], check=True)

Standard library (csv, json, os) is always available and works well for simple CSV files.`
```

## Ejemplo: Script con stdlib (✅ Probado)

```python
import csv
import json
import os
from datetime import datetime

# Find CSV file
csv_files = [f for f in os.listdir('/vercel/sandbox') if f.endswith('.csv')]
csv_path = f'/vercel/sandbox/{csv_files[0]}'

# Read CSV
data = []
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        data.append(row)

# Generate schema
schema = {}
for key in data[0].keys():
    try:
        float(data[0][key])
        schema[key] = 'number'
    except ValueError:
        schema[key] = 'string'

# Create output
output = {
    'schema': schema,
    'rowCount': len(data),
    'previewRows': data[:10],
    'data': data,
    'createdAt': datetime.now().isoformat()
}

# Save to sandbox
with open(f'/vercel/sandbox/dataset-{fileId}.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2)

print(f"✅ Processed {len(data)} rows")
```

## Ejemplo: Script con pandas (Instalación en runtime)

```python
import subprocess
import sys
import json
import os
from datetime import datetime

# Install pandas if needed
try:
    import pandas as pd
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'pandas', '--quiet'], check=True)
    import pandas as pd

# Find and read CSV
csv_files = [f for f in os.listdir('/vercel/sandbox') if f.endswith('.csv')]
df = pd.read_csv(f'/vercel/sandbox/{csv_files[0]}')

# Generate schema from dtypes
schema = {}
for col in df.columns:
    dtype = str(df[col].dtype)
    if 'int' in dtype:
        schema[col] = 'integer'
    elif 'float' in dtype:
        schema[col] = 'number'
    else:
        schema[col] = 'string'

# Convert to records
data = df.to_dict('records')

output = {
    'schema': schema,
    'rowCount': len(data),
    'previewRows': data[:10],
    'data': data,
    'createdAt': datetime.now().isoformat()
}

with open(f'/vercel/sandbox/dataset-{fileId}.json', 'w', encoding='utf-8') as f:
    json.dump(output, f)

print(f"✅ Processed {len(data)} rows with pandas")
```

## Dataset File Format

```json
{
  "schema": {
    "supplier": "string",
    "product": "string",
    "price": "number",
    "quantity": "number",
    "delivery_days": "number",
    "category": "string"
  },
  "rowCount": 15,
  "previewRows": [ /* 10 first rows */ ],
  "data": [ /* all 15 rows */ ],
  "createdAt": "2025-01-01T12:00:00.000000"
}
```

## Flujo Completo

1. **DatasetAgent** recibe sources con fileIds
2. Para cada file, llama **analyzeFile** tool
3. **AI genera Python script** apropiado (stdlib o con pandas)
4. Script se ejecuta en **Sandbox compartido**
5. Archivo procesado → JSON guardado en `/vercel/sandbox/dataset-{fileId}.json`
6. Tool retorna: `{ success, fileId, schema, rowCount, previewRows }`
7. DatasetAgent puede usar datasets generados en siguientes pasos

## Benefits

✅ **Simplicidad**: No hay agentes anidados
✅ **Flexibilidad**: AI elige stdlib o pandas según necesidad
✅ **Performance**: Un sandbox compartido
✅ **Cache**: Detecta datasets existentes
✅ **Logs**: Cada paso logeado con `console.log`
✅ **Error handling**: Captura stderr y exceptions

## Running Tests

```bash
# Test de integración completo
pnpm vitest --config vitest.config.mjs src/lib/domain/platform/dataset/analyzeFile.integration.testing.ts --run
```

## Next Steps

- [ ] Agregar soporte para Excel (.xlsx) con openpyxl
- [ ] Mejorar detección de tipos (dates, booleans)
- [ ] Agregar validación de schema
- [ ] Limitar tamaño de `data` array (para archivos grandes)


