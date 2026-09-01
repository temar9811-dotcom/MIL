using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace EveCorporationDashboard
{
    /// <summary>
    /// One-click clipboard or direct browser import: parses the copied page or live DOM, 
    /// auto-maps the expected columns by header keywords, and applies immediately.
    /// </summary>
    public partial class ImportWindow : Window
    {
        // --- EXISTING FIELDS (Retained from original implementation) ---
        private readonly List<FieldDefinition> _fields;
        private readonly Func<ImportResult, string?, string> _apply;
        private string? _lastSourceLabel;
        private readonly Func<IEnumerable<object>>? _sourcesProvider;
        private readonly IList<object> _sources;

        // Constructor (adjust parameters to match your actual implementation)
        public ImportWindow(
            List<FieldDefinition> fields,
            Func<ImportResult, string?, string> apply,
            string? lastSourceLabel,
            Func<IEnumerable<object>>? sourcesProvider,
            IList<object> sources)
        {
            InitializeComponent();
            _fields = fields;
            _apply = apply;
            _lastSourceLabel = lastSourceLabel;
            _sourcesProvider = sourcesProvider;
            _sources = sources;
        }

        // --- NEW WEBVIEW2 METHODS ---

        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            try
            {
                // Initialize the WebView2 environment
                await WebView.EnsureCoreWebView2Async(null);
            }
            catch (Exception ex)
            {
                ShowFail($"Failed to initialize browser: {ex.Message}\nPlease ensure the WebView2 Runtime is installed.");
            }
        }

        private void Navigate_Click(object sender, RoutedEventArgs e)
        {
            if (Uri.TryCreate(UrlTextBox.Text, UriKind.Absolute, out var uri))
            {
                WebView.CoreWebView2?.Navigate(uri.ToString());
            }
        }

        private async void ExtractData_Click(object sender, RoutedEventArgs e)
        {
            if (WebView.CoreWebView2 == null)
            {
                ShowFail("Browser is not initialized yet.");
                return;
            }

            try
            {
                ImportStatusText.Text = "Extracting data from page...";
                ImportStatusText.Foreground = Brushes.Gray;

                // JavaScript to extract table data from the DOM.
                // TIP: If the page has multiple tables, update the selector below. 
                // e.g., document.querySelector('table#member-list') instead of tables[0]
                string script = @"
                    () => {
                        const tables = document.querySelectorAll('table');
                        if (tables.length === 0) {
                            return JSON.stringify({ error: 'No tables found on the page. Please ensure you are on the correct page and it has fully loaded.' });
                        }
                        
                        // Grabs the first table by default. Refine selector if needed.
                        const table = tables[0]; 
                        const rows = Array.from(table.querySelectorAll('tr'));
                        
                        const data = rows.map(row => {
                            const cells = row.querySelectorAll('th, td');
                            return Array.from(cells).map(cell => cell.innerText.trim());
                        });
                        
                        return JSON.stringify({ data: data });
                    }
                ";

                // Execute script and parse the JSON result
                string jsonResult = await WebView.CoreWebView2.ExecuteScriptAsync(script);
                var result = JsonSerializer.Deserialize<JsonElement>(jsonResult);

                if (result.TryGetProperty("error", out var errorProp))
                {
                    ShowFail(errorProp.GetString() ?? "Unknown extraction error.");
                    return;
                }

                if (result.TryGetProperty("data", out var dataProp))
                {
                    var rows = new List<string[]>();
                    foreach (var row in dataProp.EnumerateArray())
                    {
                        var cellList = new List<string>();
                        foreach (var cell in row.EnumerateArray())
                        {
                            cellList.Add(cell.GetString() ?? "");
                        }
                        rows.Add(cellList.ToArray());
                    }

                    if (rows.Count < 2)
                    {
                        ShowFail("No valid table data found (needs at least a header row and one data row).");
                        return;
                    }

                    // Re-use existing mapping and application logic!
                    var mapping = AutoMap(rows[0], out string? missingColumn);
                    if (missingColumn != null)
                    {
                        ShowFail($"That doesn't look like the right page - couldn't find a '{missingColumn}' column.");
                        return;
                    }

                    var importResult = new ImportResult { DataRows = rows.Skip(1).ToList() };
                    foreach (var (key, column) in mapping) 
                    {
                        importResult.Mapping[key] = column;
                    }
                    
                    string status = _apply(importResult, _lastSourceLabel);
                    _lastSourceLabel = null;

                    // Labels can change during an apply (CEO alt corrected to forum name) - re-pull
                    if (_sourcesProvider != null)
                    {
                        _sources.Clear();
                        foreach (var item in _sourcesProvider())
                        {
                            _sources.Add(item);
                        }
                        RebuildLinksPanel();
                    }
                    else
                    {
                        UpdateSourceDates();
                    }

                    ShowSuccess(status);
                }
            }
            catch (Exception ex)
            {
                ShowFail($"Failed to extract data: {ex.Message}");
            }
        }

        // --- EXISTING CLIPBOARD METHODS (Retained as Fallback) ---

        private void Import_Click(object sender, RoutedEventArgs e)
        {
            var rows = TryReadClipboardTable();
            if (rows == null || rows.Count < 2)
            {
                ShowFail("No table found on the clipboard - open the page above, press Ctrl+A then Ctrl+C, and try again.");
                return;
            }

            var mapping = AutoMap(rows[0], out string? missingColumn);
            if (missingColumn != null)
            {
                ShowFail($"That doesn't look like the right page - couldn't find a '{missingColumn}' column.");
                return;
            }

            var result = new ImportResult { DataRows = rows.Skip(1).ToList() };
            foreach (var (key, column) in mapping) result.Mapping[key] = column;
            
            string status = _apply(result, _lastSourceLabel);
            _lastSourceLabel = null;

            if (_sourcesProvider != null)
            {
                _sources.Clear();
                foreach (var item in _sourcesProvider())
                {
                    _sources.Add(item);
                }
                RebuildLinksPanel();
            }
            else
            {
                UpdateSourceDates();
            }

            ShowSuccess(status);
        }

        /// <summary>
        /// Maps each expected field to a column by header keywords; first unclaimed match wins.
        /// </summary>
        private Dictionary<string, int> AutoMap(string[] headers, out string? missingColumn)
        {
            var mapping = new Dictionary<string, int>();
            var taken = new HashSet<int>();
            missingColumn = null;

            foreach (var field in _fields)
            {
                int found = -1;
                foreach (var keyword in field.Keywords)
                {
                    for (int i = 0; i < headers.Length && found < 0; i++)
                    {
                        if (!taken.Contains(i) && headers[i].Contains(keyword, StringComparison.OrdinalIgnoreCase))
                        {
                            found = i;
                        }
                    }
                    if (found >= 0) break;
                }

                if (found >= 0)
                {
                    mapping[field.Key] = found;
                    taken.Add(found);
                }
                else if (field.Required)
                {
                    missingColumn = field.Label;
                    return mapping;
                }
            }

            return mapping;
        }

        private static List<string[]>? TryReadClipboardTable()
        {
            string? html = null, text = null;
            try
            {
                if (Clipboard.ContainsText(TextDataFormat.Html)) 
                    html = Clipboard.GetText(TextDataFormat.Html);
                if (Clipboard.ContainsText()) 
                    text = Clipboard.GetText();
            }
            catch 
            { 
                // Clipboard can be locked by another process; treat as empty 
            }

            return TableParser.ParseClipboard(html, text);
        }

        // --- EXISTING HELPER METHODS (Ensure these match your original file) ---
        private void ShowFail(string message)
        {
            ImportStatusText.Text = message;
            ImportStatusText.Foreground = Brushes.Red; // Or your theme's error color
        }

        private void ShowSuccess(string message)
        {
            ImportStatusText.Text = message;
            ImportStatusText.Foreground = Brushes.Green; // Or your theme's success color
        }

        private void RebuildLinksPanel()
        {
            // Original implementation
        }

        private void UpdateSourceDates()
        {
            // Original implementation
        }
    }

    // --- Supporting Types (Ensure these exist in your project, likely in Models/) ---
    public class FieldDefinition
    {
        public string Key { get; set; } = "";
        public string Label { get; set; } = "";
        public string[] Keywords { get; set; } = Array.Empty<string>();
        public bool Required { get; set; }
    }

    public class ImportResult
    {
        public List<string[]> DataRows { get; set; } = new();
        public Dictionary<string, int> Mapping { get; set; } = new();
    }
}