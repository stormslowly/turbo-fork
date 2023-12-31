use anyhow::Result;
use turbo_tasks_fs::FileSystemPathVc;
use turbopack_core::chunk::{
    chunk_in_group::ChunkInGroupVc, Chunk, ChunkGroupVc, ChunkingContext, ChunkingContextVc,
    ModuleIdVc,
};

use super::{
    item::EcmascriptChunkItem,
    placeable::{EcmascriptChunkPlaceable, EcmascriptChunkPlaceablesVc},
    EcmascriptChunkVc,
};

/// Whether the ES chunk should include and evaluate a runtime.
#[turbo_tasks::value(shared)]
pub struct EcmascriptChunkEvaluate {
    /// Entries that will be executed in that order only all chunks are ready.
    /// These entries must be included in `main_entries` so that they are
    /// available.
    pub evaluate_entries: EcmascriptChunkPlaceablesVc,
    /// All chunks of this chunk group need to be ready for execution to start.
    /// When None, it will use a chunk group created from the current chunk.
    pub chunk_group: Option<ChunkGroupVc>,
    /// The path to the chunk list asset. This will be used to register the
    /// chunk list when this chunk is evaluated.
    pub chunk_list_path: Option<FileSystemPathVc>,
}

#[turbo_tasks::value_impl]
impl EcmascriptChunkEvaluateVc {
    #[turbo_tasks::function]
    pub(super) async fn content(
        self,
        context: ChunkingContextVc,
        origin_chunk: EcmascriptChunkVc,
    ) -> Result<EcmascriptChunkContentEvaluateVc> {
        let &EcmascriptChunkEvaluate {
            evaluate_entries,
            chunk_group,
            chunk_list_path,
        } = &*self.await?;
        let chunk_group =
            chunk_group.unwrap_or_else(|| ChunkGroupVc::from_chunk(origin_chunk.into()));
        let evaluate_chunks = chunk_group.chunks().await?;
        let mut ecma_chunks_server_paths = Vec::new();
        let mut other_chunks_server_paths = Vec::new();
        let output_root = context.output_root().await?;
        for chunk in evaluate_chunks.iter() {
            if let Some(chunk_in_group) = ChunkInGroupVc::resolve_from(chunk).await? {
                let chunks_server_paths = if let Some(ecma_chunk) =
                    EcmascriptChunkVc::resolve_from(chunk_in_group.inner()).await?
                {
                    if ecma_chunk == origin_chunk {
                        continue;
                    }
                    &mut ecma_chunks_server_paths
                } else {
                    &mut other_chunks_server_paths
                };
                let chunk_path = &*chunk.path().await?;
                if let Some(chunk_server_path) = output_root.get_path_to(chunk_path) {
                    chunks_server_paths.push(chunk_server_path.to_string());
                }
            }
        }
        let entry_modules_ids = evaluate_entries
            .await?
            .iter()
            .map(|entry| entry.as_chunk_item(context).id())
            .collect();
        let chunk_list_path = if let Some(chunk_list_path) = chunk_list_path {
            let chunk_list_path = chunk_list_path.await?;
            output_root
                .get_path_to(&chunk_list_path)
                .map(|path| path.to_string())
        } else {
            None
        };
        Ok(EcmascriptChunkContentEvaluate {
            ecma_chunks_server_paths,
            other_chunks_server_paths,
            entry_modules_ids,
            chunk_list_path,
        }
        .cell())
    }
}

#[turbo_tasks::value]
pub(super) struct EcmascriptChunkContentEvaluate {
    pub ecma_chunks_server_paths: Vec<String>,
    pub other_chunks_server_paths: Vec<String>,
    pub entry_modules_ids: Vec<ModuleIdVc>,
    pub chunk_list_path: Option<String>,
}
