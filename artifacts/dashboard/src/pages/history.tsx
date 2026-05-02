import { useGetHistory } from "@workspace/api-client-react";
import { USER_ID, BASE_PATH } from "@/lib/constants";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Activity, Target, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function History() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<"workout" | "diet" | "all">("all");
  const [month, setMonth] = useState<string>("all");
  const [year, setYear] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useGetHistory(USER_ID, {
    page,
    limit: 15,
    type: type === "all" ? undefined : type,
  });

  const filteredHistory = (data?.history ?? []).filter((item: any) => {
    const d = new Date(item.completedAt);
    if (month !== "all" && d.getMonth() !== parseInt(month)) return false;
    if (year !== "all" && d.getFullYear() !== parseInt(year)) return false;
    return true;
  });

  const handleRemove = async (index: number) => {
    try {
      const res = await fetch(`${BASE_PATH}api/log-completion/${USER_ID}/${index}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Entry removed" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["getState", USER_ID] });
    } catch {
      toast({ title: "Failed to remove entry", variant: "destructive" });
    }
  };

  const clearFilters = () => {
    setType("all");
    setMonth("all");
    setYear("all");
    setPage(1);
  };

  const hasActiveFilters = type !== "all" || month !== "all" || year !== "all";

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Activity Log</h2>
        <p className="text-muted-foreground">Your detailed completion history.</p>
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={type} onValueChange={(val: any) => { setType(val); setPage(1); }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Activity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="workout">Workouts</SelectItem>
            <SelectItem value="diet">Diet</SelectItem>
          </SelectContent>
        </Select>

        <Select value={month} onValueChange={(val) => { setMonth(val); setPage(1); }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={year} onValueChange={(val) => { setYear(val); setPage(1); }}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
            <X className="w-3 h-3" />
            Clear filters
          </Button>
        )}

        <div className="ml-auto text-sm text-muted-foreground">
          {filteredHistory.length} entries shown
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">Loading...</div>
          ) : filteredHistory.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              No activity found for the selected filters.
            </div>
          ) : (
            <div className="divide-y">
              {filteredHistory.map((item: any, i: number) => (
                <div key={i} className="p-5 flex items-center justify-between hover:bg-muted/50 transition-colors group">
                  <div className="flex items-center gap-5">
                    <div
                      className={`p-3 rounded-full ${
                        item.type === "workout"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-green-500/10 text-green-500"
                      }`}
                    >
                      {item.type === "workout" ? <Activity className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="text-base font-semibold capitalize">{item.type}</h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(item.completedAt), "MMMM d, yyyy 'at' h:mm a")}
                      </p>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">{item.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-bold text-primary">+{item.xpGained} XP</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleRemove(i)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex justify-center items-center gap-4">
          <Button variant="outline" disabled={!data.pagination.hasPrev} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Button variant="outline" disabled={!data.pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}
