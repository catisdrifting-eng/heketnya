'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface TeamMember {
  user_id: string;
  name: string;
  email: string;
}

interface Attachment {
  id: string;
  project_id: string;
  task_id: string | null;
  uploader_id: string;
  file_name: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
}

const MAX_SIZE_BYTES = 52428800; // 50MB

// ─── 파일 크기 포맷 ────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function ProjectFilesPage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // ── 업로드 상태 ──────────────────────────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── 다운로드 상태 ────────────────────────────────────────────────────────
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ── 삭제 상태 ────────────────────────────────────────────────────────────
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── 데이터 로드 ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData?.user?.id ?? null);

    const [attachmentsRes, membersRes] = await Promise.all([
      supabase
        .from('attachments')
        .select('id, project_id, task_id, uploader_id, file_name, file_path, size_bytes, created_at')
        .eq('project_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('project_members')
        .select('user_id, users(id, name, email)')
        .eq('project_id', id),
    ]);

    if (attachmentsRes.data) {
      setAttachments(attachmentsRes.data as Attachment[]);
    }

    if (membersRes.data) {
      const parsed: TeamMember[] = membersRes.data.map((row: any) => ({
        user_id: row.user_id,
        name: row.users?.name ?? row.users?.email ?? '알 수 없음',
        email: row.users?.email ?? '',
      }));
      setMembers(parsed);
    }

    setIsLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── 업로드한 사람 이름 조회 헬퍼 ─────────────────────────────────────────
  const getUploaderName = (userId: string) => {
    const m = members.find((m) => m.user_id === userId);
    return m ? m.name : '알 수 없음';
  };

  // ── 파일 선택 ────────────────────────────────────────────────────────────
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadError(null);
    if (file && file.size > MAX_SIZE_BYTES) {
      setUploadError('50MB 이하만 올릴 수 있어요.');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }, []);

  // ── 업로드 ───────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!selectedFile || isUploading) return;

    if (selectedFile.size > MAX_SIZE_BYTES) {
      setUploadError('50MB 이하만 올릴 수 있어요.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const supabase = createClient();

      const { data: userData } = await supabase.auth.getUser();
      const uploaderId = userData?.user?.id;
      if (!uploaderId) {
        setUploadError('로그인 정보를 확인할 수 없어요.');
        return;
      }

      const extMatch = selectedFile.name.match(/\.([^.]+)$/);
      const ext = extMatch ? extMatch[1] : '';
      const storagePath = ext
        ? `${id}/${crypto.randomUUID()}.${ext}`
        : `${id}/${crypto.randomUUID()}`;

      const { error: uploadErr } = await supabase.storage
        .from('project-files')
        .upload(storagePath, selectedFile);

      if (uploadErr) {
        setUploadError('파일 업로드에 실패했어요.');
        return;
      }

      const { data: insertData, error: insertErr } = await supabase
        .from('attachments')
        .insert({
          project_id: id,
          uploader_id: uploaderId,
          file_name: selectedFile.name.normalize('NFC'),
          file_path: storagePath,
          size_bytes: selectedFile.size,
        })
        .select();

      if (insertErr || !insertData || insertData.length === 0) {
        // insert 실패 시 방금 올린 스토리지 객체를 되돌린다
        await supabase.storage.from('project-files').remove([storagePath]);
        setUploadError('파일 정보 저장에 실패했어요.');
        return;
      }

      setSelectedFile(null);
      await load();
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile, isUploading, id, load]);

  // ── 다운로드 ─────────────────────────────────────────────────────────────
  const handleDownload = useCallback(async (att: Attachment) => {
    setDownloadError(null);
    setDownloadingId(att.id);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from('project-files')
        .download(att.file_path);

      if (error || !data) {
        setDownloadError(`'${att.file_name}' 다운로드에 실패했어요.`);
        return;
      }

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.file_name.normalize('NFC');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(`'${att.file_name}' 다운로드에 실패했어요.`);
    } finally {
      setDownloadingId(null);
    }
  }, []);

  // ── 삭제 ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (att: Attachment) => {
      setDeletingId(att.id);
      setDeleteError(null);

      try {
        const supabase = createClient();

        const { error: storageErr } = await supabase.storage
          .from('project-files')
          .remove([att.file_path]);

        if (storageErr) {
          setDeleteError(`'${att.file_name}' 삭제에 실패했어요.`);
          setConfirmingDeleteId(null);
          return;
        }

        const { data, error } = await supabase
          .from('attachments')
          .delete()
          .eq('id', att.id)
          .select();

        if (error || !data || data.length === 0) {
          setDeleteError(`'${att.file_name}' 삭제에 실패했어요.`);
          setConfirmingDeleteId(null);
          return;
        }

        setConfirmingDeleteId(null);
        await load();
      } finally {
        setDeletingId(null);
      }
    },
    [load],
  );

  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ── 업로드 ───────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">파일 업로드</h2>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="file"
            onChange={handleFileSelect}
            className="flex-1 min-w-0 text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? '업로드 중...' : '업로드'}
          </button>
        </div>

        {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
      </section>

      {/* ── 목록 ─────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-gray-900">파일 목록</h2>

        {downloadError && <p className="text-xs text-red-500">{downloadError}</p>}
        {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}

        {attachments.length === 0 ? (
          <p className="text-sm text-gray-400">아직 올린 파일이 없어요.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => handleDownload(att)}
                  disabled={downloadingId === att.id}
                  className="flex-1 min-w-0 truncate text-left text-sm font-medium text-gray-900 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {downloadingId === att.id ? '받는 중...' : att.file_name}
                </button>

                <span className="shrink-0 text-xs text-gray-400">
                  {getUploaderName(att.uploader_id)}
                </span>

                <span className="shrink-0 text-xs text-gray-400">
                  {formatSize(att.size_bytes)}
                </span>

                <span className="shrink-0 text-xs text-gray-400">
                  {new Date(att.created_at).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>

                {currentUserId === att.uploader_id && (
                  <div className="flex items-center gap-2 shrink-0">
                    {confirmingDeleteId === att.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(att)}
                          disabled={deletingId === att.id}
                          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40 transition"
                        >
                          {deletingId === att.id ? '삭제 중...' : '삭제'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={deletingId === att.id}
                          className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40 transition"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(att.id)}
                        className="text-xs text-gray-300 hover:text-red-500 transition"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
