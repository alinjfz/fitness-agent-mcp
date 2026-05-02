import { useGetState } from "@workspace/api-client-react";
import { USER_ID } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Award } from "lucide-react";

export default function Achievements() {
  const { data, isLoading } = useGetState(USER_ID);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Achievements</h2>
        <p className="text-muted-foreground">Your trophy room.</p>
      </header>

      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data?.progress?.achievements?.map((ach: any) => (
            <Card key={ach.id} className="relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform">
                <Award className="w-24 h-24" />
              </div>
              <CardHeader>
                <div className="w-12 h-12 rounded-full bg-yellow-500/20 text-yellow-500 flex items-center justify-center mb-4">
                  <Award className="w-6 h-6" />
                </div>
                <CardTitle className="text-xl">{ach.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">{ach.description}</p>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-primary">+{ach.xpBonus} XP</span>
                  <span className="text-muted-foreground">{format(new Date(ach.earnedAt), "MMM d, yyyy")}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!data?.progress?.achievements || data.progress.achievements.length === 0) && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              No achievements yet. Keep working out!
            </div>
          )}
        </div>
      )}
    </div>
  );
}