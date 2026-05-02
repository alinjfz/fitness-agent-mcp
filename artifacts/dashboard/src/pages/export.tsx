import { useState } from "react";
import { useExportReport } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy } from "lucide-react";

export default function Export() {
  const [format, setFormat] = useState<"json" | "csv" | "html" | "markdown">("json");
  const { data, isLoading, refetch } = useExportReport(USER_ID, { format }, { query: { enabled: false } });
  const { toast } = useToast();

  const handleExport = async () => {
    const res = await refetch();
    if (res.data) {
      if (format === "markdown" && typeof res.data === "string") {
        navigator.clipboard.writeText(res.data);
        toast({ title: "Copied to clipboard" });
      } else if (typeof res.data === 'object' && (res.data as any).downloadUrl) {
        window.open((res.data as any).downloadUrl, "_blank");
      }
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Export Data</h2>
        <p className="text-muted-foreground">Download your fitness report or copy it to Notion.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Generate Report</CardTitle>
          <CardDescription>Select a format and generate your full progress report.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex gap-4 items-center">
            <div className="w-[200px]">
              <Select value={format} onValueChange={(val: any) => setFormat(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleExport} disabled={isLoading} className="gap-2">
              {format === "markdown" ? <Copy className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {format === "markdown" ? "Copy to Clipboard" : "Download"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}