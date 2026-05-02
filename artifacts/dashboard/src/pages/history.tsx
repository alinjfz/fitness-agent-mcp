import { useGetHistory } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Activity, Target, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

export default function History() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<"workout" | "diet" | "all">("all");
  
  const { data, isLoading } = useGetHistory(USER_ID, {
    page,
    limit: 10,
    type: type === "all" ? undefined : type,
  });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Activity Log</h2>
          <p className="text-muted-foreground">Your detailed completion history.</p>
        </div>
        <div>
          <Select value={type} onValueChange={(val: any) => { setType(val); setPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Activities</SelectItem>
              <SelectItem value="workout">Workouts</SelectItem>
              <SelectItem value="diet">Diet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">Loading...</div>
          ) : (
            <div className="divide-y">
              {data?.history?.map((item: any, i: number) => (
                <div key={i} className="p-6 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-6">
                    <div className={`p-3 rounded-full ${item.type === 'workout' ? 'bg-blue-500/10 text-blue-500' : 'bg-green-500/10 text-green-500'}`}>
                      {item.type === 'workout' ? <Activity className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold capitalize">{item.type}</h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(item.completedAt), "MMMM d, yyyy 'at' h:mm a")}
                      </p>
                      {item.notes && <p className="text-sm mt-1">{item.notes}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-primary">+{item.xpGained} XP</div>
                  </div>
                </div>
              ))}
              
              {(!data?.history || data.history.length === 0) && (
                <div className="p-12 text-center text-muted-foreground">
                  No activity found.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex justify-center items-center gap-4">
          <Button
            variant="outline"
            disabled={!data.pagination.hasPrev}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            disabled={!data.pagination.hasNext}
            onClick={() => setPage(p => p + 1)}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}