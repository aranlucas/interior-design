import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudioState } from "./use-studio";
import type { Room } from "../lib/types";
import type { PhotoMatches, ReconstructedScene } from "../lib/reconstruction";
import type { AiRoomLayout } from "../lib/ai-room-layout";
import { api, json } from "../lib/studio-client";

export function useReconstruction(state: StudioState) {
  const room = state.room!;
  const client = useQueryClient();
  const key = ["reconstruction", room.id];
  const status = useQuery({
    queryKey: key,
    enabled: typeof window !== "undefined",
    queryFn: async () => {
      const result = await api<{ room: Room; available: boolean; aiAvailable: boolean }>(
        `/api/reconstruct?roomId=${room.id}`,
      );
      await state.update(result.room);
      return result;
    },
    refetchInterval: (query) =>
      query.state.data?.room.reconstruction?.status === "running" ? 1500 : false,
    refetchIntervalInBackground: true,
  });
  const result = room.reconstruction?.result;
  const scene = useQuery({
    queryKey: ["reconstruction-result", room.id, result?.id],
    enabled: !!result,
    queryFn: () =>
      api<ReconstructedScene>(`/api/reconstruct?roomId=${room.id}&resultId=${result!.id}`),
    staleTime: Infinity,
  });
  const build = useMutation({
    mutationFn: async ({
      matches,
      mode,
    }: {
      matches?: PhotoMatches;
      mode: "classical" | "ai-layout";
    }) => {
      const response = await api<{ room: Room }>(
        "/api/reconstruct",
        json({ roomId: room.id, matches, mode }),
      );
      await state.update(response.room);
      client.setQueryData(key, { ...status.data, room: response.room });
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      await api("/api/reconstruct", {
        ...json({ roomId: room.id, jobId: room.reconstruction!.id }),
        method: "DELETE",
      });
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const saveLayout = useMutation({
    mutationFn: async (layout: AiRoomLayout) => {
      const response = await api<{ room: Room; scene: ReconstructedScene }>("/api/reconstruct", {
        ...json({ roomId: room.id, resultId: result!.id, layout }),
        method: "PATCH",
      });
      client.setQueryData(["reconstruction-result", room.id, result?.id], response.scene);
      await state.update(response.room);
    },
  });
  return { status, scene, build, cancel, saveLayout };
}
