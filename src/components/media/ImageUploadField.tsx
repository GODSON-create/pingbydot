import { useRef, useState } from "react";
import { Camera, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { takePhoto } from "@/lib/native";
import { validateMediaUpload } from "@/lib/shield";
import { buildPublicMediaPath, uploadUserMedia } from "@/lib/storage";

interface ImageUploadFieldProps {
  value: string;
  onChange: (url: string) => void;
  userId?: string | undefined;
  folder: "avatars" | "hubs" | "signals";
  label?: string | undefined;
  placeholder?: string | undefined;
  fallbackName?: string | undefined;
  shape?: "circle" | "rounded" | undefined;
  inputId?: string | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
}

export function ImageUploadField({
  value,
  onChange,
  userId,
  folder,
  label = "Image",
  placeholder = "https://…",
  fallbackName = "Ping",
  shape = "rounded",
  inputId,
  disabled = false,
  error,
}: ImageUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadFile = async (file: File) => {
    if (!userId) {
      toast.error("Please sign in to upload images.");
      return;
    }

    const check = validateMediaUpload(
      { type: file.type, size: file.size, name: file.name },
      "image",
    );
    if (!check.valid) {
      const msg = check.error || "Invalid image file.";
      setUploadError(msg);
      toast.error(msg);
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const path = buildPublicMediaPath(userId, folder, file.name, "jpg");
      const url = await uploadUserMedia(path, file, {
        cacheControl: "31536000",
        upsert: false,
        ownerId: userId,
        optimizeImage: { maxDimension: folder === "avatars" ? 512 : 1600, quality: 0.84 },
      });
      onChange(url);
      toast.success("Image uploaded");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Image upload failed.";
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      void uploadFile(file);
    }
  };

  const handleTakePhoto = async () => {
    const file = await takePhoto();
    if (file) {
      await uploadFile(file);
    }
  };

  const displayError = error || uploadError;

  return (
    <div className="space-y-2.5">
      {label && (
        <Label htmlFor={inputId} className="text-sm font-semibold">
          {label}
        </Label>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 rounded-2xl border border-border/70 bg-secondary/25 p-3.5">
        {shape === "circle" ? (
          <FounderAvatar name={fallbackName} src={value || null} size="lg" />
        ) : value ? (
          <img
            src={value}
            alt={fallbackName}
            className="size-14 rounded-2xl object-cover border border-border shrink-0"
          />
        ) : (
          <div className="size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-display font-bold text-lg shrink-0">
            {fallbackName.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || disabled}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full text-xs gap-1.5 min-h-9"
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {uploading ? "Uploading…" : "Upload photo"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || disabled}
              onClick={() => void handleTakePhoto()}
              className="rounded-full text-xs gap-1.5 min-h-9"
            >
              <Camera className="size-3.5" /> Take photo
            </Button>

            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading || disabled}
                onClick={() => {
                  onChange("");
                  setUploadError(null);
                }}
                className="rounded-full text-xs text-muted-foreground min-h-9 gap-1"
              >
                <X className="size-3.5" /> Remove
              </Button>
            )}
          </div>

          <Input
            id={inputId}
            type="url"
            value={value}
            onChange={(e) => {
              setUploadError(null);
              onChange(e.target.value);
            }}
            placeholder={placeholder}
            disabled={uploading || disabled}
            className="h-9 rounded-xl text-xs bg-card"
          />
        </div>
      </div>

      {displayError && (
        <p role="alert" className="text-xs text-destructive">
          {displayError}
        </p>
      )}
    </div>
  );
}
