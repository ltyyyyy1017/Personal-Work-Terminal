# 報銷材料識別

電子 PDF 優先讀取文字、內嵌字型映射與表格座標；圖片、掃描 PDF 可使用本機 RapidOCR。文件內容不會上傳到第三方 OCR 服務，不需要 OCR API 金鑰。

## 安裝中文 OCR

需要 Python 3.11 以上與相容的 ONNX Runtime 執行環境：

```sh
python3 -m venv /absolute/path/to/ocr-venv
/absolute/path/to/ocr-venv/bin/python -m pip install -r scripts/ocr-requirements.txt
```

在工作台環境設定 `WORKBENCH_OCR_PYTHON=/absolute/path/to/ocr-venv/bin/python` 並重新啟動。Windows 請使用虛擬環境的 `Scripts/python.exe` 絕對路徑。未設定時使用內建 Tesseract 備用識別；舊 XLS 與部分 HEIC/HEIF 需要 Python 引擎。使用預設隨套件提供的模型；伺服器執行帳號不應有修改套件或程式碼的權限。

支援上傳 PDF、JPG、PNG、WebP、GIF、BMP、TIFF、AVIF、HEIC/HEIF、OFD、XML、TXT、Markdown、CSV、JSON、Word（DOC/DOCX）、Excel（XLS/XLSX）。OFD 目前讀取文字物件，純圖片 OFD 請另匯出 PDF。Office、OFD 及新增圖片格式會在材料包中保留原檔，不會冒稱已轉成 PDF。TXT、Markdown、CSV 的匯出文字會轉為繁體字。

每份自動識別上限 15 MB；文字格式 1 MB。PDF 最多 20 頁，其中掃描頁最多自動識別 3 頁。壓縮文件另有限制解壓大小、項目數與工作表列數。原有附件可在報銷詳情按「重新識別材料」，核對結果後勾選套用，無需重複上傳。

## 欄位規則

- 費用日期優先取行程／乘車日期，其次取支付／交易日期，再取明確標示的費用日期。開票日期另存於發票資料，不用作費用日期，也不自動補今天。
- 多個日期或多條不同路線會顯示衝突，不把第一個結果當作整份材料。
- 購買方與銷售方分欄處理；無法分辨時保留空白。稅號、抬頭及金額仍須核對原件，這不是稅局驗真服務。
- 同行人只從明確的同行人標籤或同行名單抽取；不以登入者、付款人或經辦人代替實際報銷人。
- 收款銀行及帳號不參與表單、識別或匯出。舊資料不作破壞性刪除。

使用持續維護的 [RapidOCR](https://github.com/RapidAI/RapidOCR) 作為中文 OCR 引擎；其基於 PaddleOCR 模型與 ONNX Runtime。發票欄位、行程表格及報銷日期規則由本專案處理。
