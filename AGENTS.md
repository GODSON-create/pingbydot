<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Public feed, Ping and profile reads use anonymous server functions with an explicit author foreign key, so SSR share pages never depend on browser sessions or ambiguous joins.
- Feed pagination belongs in validated URL search parameters so older Pings remain reachable and shareable.
- Share artwork uses one Satori tree with embedded font and CSS artwork tokens; browser PNG previews are the exported files, while public social PNGs use the same full card scaled to fit without cropping.
- Public social images read only public Ping fields, never fetch arbitrary remote media server-side, and use short caching plus content-derived ETags so edits and deletions revalidate.
