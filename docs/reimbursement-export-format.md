# 報銷匯出格式

報銷設定可按部門選擇「標準報銷明細」或「收支明細表（綠色模板）」，並設定屆次、學年等表格標題。格式會同時用於單筆報銷和整個事項的匯出。

收支明細表位於原有 Excel 的第一頁。欄位依次為序號、日期、內容、支出（具體名稱、單價×數量／報銷人、金額）、收入、收支後、備註。每項費用列一次，按實際費用日期排序；相同日期合併顯示。報銷人後用全形括號列出同行人，例如「報銷人甲（同行人乙，同行人丙）」；未填同行人時只顯示報銷人，起終點列於備註。原有的整個事項統計、全部明細和材料目錄繼續保留，其中仍明確標註同行人。

目前工作台記錄的是報銷支出，因此收入欄留空，「收支後」沿用參考表格的支出合計公式，並非銀行結餘。缺少費用日期或金額時會標示待補充；不從開票日期或登入者代填，也不編造單價及數量。重新生成材料包後，既有記錄也會使用新格式。

擴充設定存放於 `settings.reimbursement.exportFormats`，以已設定的部門 ID 為鍵：

```json
{
  "exportFormats": {
    "your-department-id": {
      "format": "income-expense",
      "title": "組織收支明細表（學年）"
    }
  }
}
```

使用 `format: "standard"` 可保留標準格式。更新單一部門的設定會保留其他部門的格式。

## Export script by department

Generated package names, folders, material filenames, text manifests and spreadsheet text use Simplified Chinese for the publicity department and Traditional Chinese only for the internal affairs department. Bulk exports keep each reimbursement’s own department script; mixed-department outer bundle labels use Simplified Chinese. The same rule covers single reimbursements and whole matters. Existing publicity packages generated under the old rule are rebuilt on the next ZIP/Excel download. Source invoice and Office binaries remain original attachments.
