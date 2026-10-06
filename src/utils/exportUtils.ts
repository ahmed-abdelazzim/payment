/**
 * Sarraf Ops - Enterprise Data Export Engine
 * Generates UTF-8 BOM CSV (100% Microsoft Excel compatible for Arabic text)
 * and rich HTML/XML Spreadsheet formats for instant download.
 */

export interface ExportColumn<T = any> {
  header: string;
  headerAr?: string;
  key?: keyof T;
  accessor?: (item: T) => string | number | null | undefined;
}

/**
 * Escapes CSV values, properly handles quotes, commas, newlines,
 * and defends against CSV Formula Injection (=, +, -, @).
 */
function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) {
    return '""';
  }
  let str = String(val).trim();
  // Prevent CSV formula injection in spreadsheet software
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Replace internal quotes with double quotes
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Downloads a string payload as a file in the browser.
 */
function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports data to a CSV file with UTF-8 BOM so Excel opens Arabic text cleanly.
 */
export function exportToCsv<T>(
  filename: string,
  columns: ExportColumn<T>[],
  data: T[],
  language: 'ar' | 'en' = 'ar'
): void {
  // UTF-8 BOM (\uFEFF) is mandatory for Excel to render Arabic correctly
  const BOM = '\uFEFF';
  
  // Headers row
  const headerRow = columns
    .map((col) => escapeCsvValue(language === 'ar' ? (col.headerAr || col.header) : col.header))
    .join(',');

  // Data rows
  const dataRows = data.map((item) => {
    return columns
      .map((col) => {
        let value: any = '';
        if (col.accessor) {
          value = col.accessor(item);
        } else if (col.key) {
          value = item[col.key];
        }
        return escapeCsvValue(value);
      })
      .join(',');
  });

  const csvContent = BOM + [headerRow, ...dataRows].join('\r\n');
  const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  triggerDownload(csvContent, safeFilename, 'text/csv;charset=utf-8;');
}

/**
 * Exports data as an Excel-friendly HTML Spreadsheet (.xls).
 * Automatically sets right-to-left layout and clean table borders.
 */
export function exportToExcelTable<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  data: T[],
  language: 'ar' | 'en' = 'ar'
): void {
  const isAr = language === 'ar';
  const headers = columns
    .map((col) => `<th style="background-color: #0f172a; color: #ffffff; padding: 10px; font-weight: bold; border: 1px solid #cbd5e1;">${isAr ? (col.headerAr || col.header) : col.header}</th>`)
    .join('');

  const rows = data
    .map((item, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const cells = columns
        .map((col) => {
          let value: any = '';
          if (col.accessor) {
            value = col.accessor(item);
          } else if (col.key) {
            value = item[col.key];
          }
          const str = value === null || value === undefined ? '' : String(value);
          return `<td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: ${isAr ? 'right' : 'left'};">${str}</td>`;
        })
        .join('');
      return `<tr style="background-color: ${bg};">${cells}</tr>`;
    })
    .join('');

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8" />
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${title.slice(0, 31)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: ${isAr ? 'rtl' : 'ltr'}; }
        table { border-collapse: collapse; width: 100%; }
        h2 { color: #0f172a; }
      </style>
    </head>
    <body>
      <h2>${title}</h2>
      <p style="font-size: 12px; color: #64748b;">تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}</p>
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `;

  const safeFilename = filename.endsWith('.xls') ? filename : `${filename}.xls`;
  triggerDownload(html, safeFilename, 'application/vnd.ms-excel;charset=utf-8;');
}
