import { useState, useRef } from "react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, CheckCircle, AlertCircle, Eye, Save } from "lucide-react";
import { useIngestData } from "@workspace/api-client-react";

export default function Import() {
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<{
    summary: string;
    detectedType: string;
    confidence: string;
    saved: boolean;
  } | null>(null);
  const [previewOnly, setPreviewOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ingest = useIngestData();
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);
      const base64 = dataUrl.split(",")[1] ?? "";
      setImageBase64(base64);
      setExtractedData(null);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);
      setImageBase64(dataUrl.split(",")[1] ?? "");
      setExtractedData(null);
    };
    reader.readAsDataURL(file);
  };

  const handleImport = (save: boolean) => {
    if (!text.trim() && !imageBase64) return;

    ingest.mutate(
      {
        data: {
          userId: USER_ID,
          ...(text.trim() ? { text: text.trim() } : {}),
          ...(imageBase64 ? { imageBase64 } : {}),
          save,
        },
      },
      {
        onSuccess: (res: any) => {
          setExtractedData({
            summary: res.summary,
            detectedType: res.detectedType,
            confidence: res.confidence,
            saved: res.saved,
          });
          if (save) {
            toast({ title: "Saved to your profile", description: res.summary });
          } else {
            toast({ title: "Preview ready", description: "Review the extraction below, then save." });
          }
        },
        onError: () => {
          toast({ title: "Import failed", description: "Check your input and try again.", variant: "destructive" });
        },
      }
    );
  };

  const hasInput = text.trim().length > 0 || imageBase64 !== null;
  const confidenceColor = extractedData?.confidence === "high"
    ? "text-green-400"
    : extractedData?.confidence === "medium"
    ? "text-yellow-400"
    : "text-red-400";

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Import Data</h2>
        <p className="text-muted-foreground">Paste notes or upload a photo — AI extracts your workout or diet plan automatically.</p>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Text Import
            </CardTitle>
            <CardDescription>Paste raw text notes, a workout description, or a diet plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={"e.g. 'Monday: Bench press 4x8, Overhead press 3x10...'\nor 'Breakfast: eggs + oats, 550 kcal, 45g protein'"}
              className="min-h-[200px] resize-none"
              value={text}
              onChange={(e) => { setText(e.target.value); setExtractedData(null); }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Image Import
            </CardTitle>
            <CardDescription>Upload a photo of your workout plan, gym notes, or diet menu.</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:bg-muted/50 transition-colors cursor-pointer relative"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              {imagePreview ? (
                <div className="space-y-3">
                  <img
                    src={imagePreview}
                    alt="Uploaded plan"
                    className="max-h-40 mx-auto rounded-lg object-contain"
                  />
                  <p className="text-xs text-muted-foreground">Click to change image</p>
                </div>
              ) : (
                <>
                  <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Upload className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-medium mb-1">Click or drag to upload</h3>
                  <p className="text-sm text-muted-foreground">JPEG, PNG, WebP</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleFileChange}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {hasInput && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => handleImport(false)}
            disabled={ingest.isPending}
            className="gap-2"
          >
            <Eye className="w-4 h-4" />
            {ingest.isPending && previewOnly ? "Extracting..." : "Preview Extraction"}
          </Button>
          <Button
            onClick={() => { setPreviewOnly(false); handleImport(true); }}
            disabled={ingest.isPending}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            {ingest.isPending && !previewOnly ? "Saving..." : "Extract & Save"}
          </Button>
        </div>
      )}

      {extractedData && (
        <Card className={extractedData.saved ? "border-green-500/30" : "border-yellow-500/30"}>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-start gap-3">
              {extractedData.saved ? (
                <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1">
                <p className="font-semibold">
                  {extractedData.saved ? "Saved to your profile" : "Preview — not saved yet"}
                </p>
                <p className="text-sm text-muted-foreground">{extractedData.summary}</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm pt-1">
              <span>
                Type: <span className="font-medium capitalize">{extractedData.detectedType}</span>
              </span>
              <span>
                Confidence: <span className={`font-medium capitalize ${confidenceColor}`}>{extractedData.confidence}</span>
              </span>
            </div>
            {!extractedData.saved && (
              <Button size="sm" onClick={() => handleImport(true)} disabled={ingest.isPending} className="mt-2 gap-2">
                <Save className="w-4 h-4" />
                Save Now
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
