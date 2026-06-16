import * as React from "react";
import { toast } from "sonner";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { ICON_GROUPS, getIcon } from "@/lib/iconRegistry";
import { cn } from "@/lib/utils";

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899",
  "#06B6D4", "#84CC16", "#F97316", "#6366F1", "#14B8A6", "#A855F7",
];

const COMMON_EMOJIS = [
  "🏦", "💳", "💰", "💵", "🪙", "💎", "🏠", "🛒", "🍕", "☕", "🍷", "🍺",
  "🚗", "✈️", "🚆", "⛽", "🎁", "🎉", "🎮", "🎬", "📚", "💊", "🏥", "💪",
  "👕", "👟", "📱", "💻", "🐶", "🐱", "🌳", "☀️", "🔥", "⚡", "✨", "⭐",
];

interface Props {
  value: { icon?: string | null; emoji?: string | null; image_url?: string | null; color?: string | null };
  entityId: string;
  onChange: (patch: { icon: string | null; emoji: string | null; image_url: string | null; color: string | null }) => void;
  labels: {
    icon: string; emoji: string; image: string; color: string;
    upload: string; remove: string; uploadHint: string;
  };
}

export function IconPicker({ value, entityId, onChange, labels }: Props) {
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const setColor = (c: string) => onChange({ icon: value.icon ?? null, emoji: value.emoji ?? null, image_url: value.image_url ?? null, color: c });
  const setIcon = (name: string) => onChange({ icon: name, emoji: null, image_url: null, color: value.color ?? null });
  const setEmoji = (e: string) => onChange({ icon: null, emoji: e, image_url: null, color: value.color ?? null });
  const setImage = (url: string | null) => onChange({ icon: null, emoji: null, image_url: url, color: value.color ?? null });

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error(labels.uploadHint); return; }
    const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error("Only PNG, JPEG, WebP, or GIF images are allowed");
      return;
    }
    setUploading(true);
    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = extMap[file.type] ?? "png";
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) { setUploading(false); toast.error("Not signed in"); return; }
    const path = `${userData.user.id}/${entityId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("account-category-images").upload(path, file, { upsert: true, contentType: extMap[file.type] === "jpg" ? "image/jpeg" : `image/${extMap[file.type]}` });
    if (upErr) { setUploading(false); toast.error(upErr.message); return; }
    const { data } = supabase.storage.from("account-category-images").getPublicUrl(path);
    setImage(data.publicUrl);
    setUploading(false);
  };

  return (
    <div className="space-y-3">
      <Tabs defaultValue={value.image_url ? "image" : value.emoji ? "emoji" : "icon"}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="icon">{labels.icon}</TabsTrigger>
          <TabsTrigger value="emoji">{labels.emoji}</TabsTrigger>
          <TabsTrigger value="image">{labels.image}</TabsTrigger>
        </TabsList>

        <TabsContent value="icon" className="max-h-64 space-y-3 overflow-y-auto">
          {ICON_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</div>
              <div className="grid grid-cols-8 gap-1">
                {g.names.map((n) => {
                  const Icon = getIcon(n);
                  const sel = value.icon === n && !value.emoji && !value.image_url;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setIcon(n)}
                      className={cn("flex h-8 w-8 items-center justify-center rounded-md border", sel ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}
                      title={n}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="emoji">
          <div className="grid grid-cols-8 gap-1">
            {COMMON_EMOJIS.map((e) => {
              const sel = value.emoji === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={cn("flex h-8 w-8 items-center justify-center rounded-md border text-lg", sel ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}
                >
                  {e}
                </button>
              );
            })}
          </div>
          <Input
            className="mt-2"
            maxLength={4}
            placeholder="Or type any emoji…"
            value={value.emoji ?? ""}
            onChange={(e) => setEmoji(e.target.value)}
          />
        </TabsContent>

        <TabsContent value="image" className="space-y-2">
          {value.image_url && (
            <div className="flex items-center gap-2">
              <img src={value.image_url} alt="" className="h-12 w-12 rounded-md object-cover" />
              <Button variant="ghost" size="sm" onClick={() => setImage(null)}>
                <Trash2 className="h-4 w-4" /> {labels.remove}
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> {uploading ? "…" : labels.upload}
          </Button>
          <p className="text-[11px] text-muted-foreground">{labels.uploadHint}</p>
        </TabsContent>
      </Tabs>

      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{labels.color}</div>
        <div className="flex flex-wrap gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn("h-6 w-6 rounded-full border-2", value.color === c ? "border-foreground" : "border-transparent")}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
