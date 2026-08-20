-- 프로젝트 멤버 전원에게 tasks 테이블 INSERT/DELETE 권한을 부여하는 RLS 정책.
-- 대시보드 화면(/project/[id]/dashboard)에서 태스크 추가·삭제 기능을 구현하며,
-- Supabase RLS 때문에 INSERT/DELETE가 막힐 경우를 대비해 작성했다.
-- 이 파일은 자동으로 실행되지 않는다. 필요할 때 Supabase SQL Editor 등에서
-- 직접 검토 후 실행할 것.

-- 전제:
--   - tasks 테이블에는 project_id 컬럼이 있고, project_members 테이블에
--     (project_id, user_id) 조합으로 프로젝트 멤버 여부를 확인할 수 있다.
--   - projects 테이블에는 owner_id 컬럼이 있어 개설자도 프로젝트 멤버로 간주한다.

-- ── INSERT 정책: 프로젝트 멤버(개설자 포함) 전원이 태스크를 추가할 수 있다 ──
drop policy if exists "tasks_insert_project_members" on public.tasks;

create policy "tasks_insert_project_members"
on public.tasks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.project_members pm
    where pm.project_id = tasks.project_id
      and pm.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.projects p
    where p.id = tasks.project_id
      and p.owner_id = auth.uid()
  )
);

-- ── DELETE 정책: 프로젝트 멤버(개설자 포함) 전원이 태스크를 삭제할 수 있다 ──
drop policy if exists "tasks_delete_project_members" on public.tasks;

create policy "tasks_delete_project_members"
on public.tasks
for delete
to authenticated
using (
  exists (
    select 1
    from public.project_members pm
    where pm.project_id = tasks.project_id
      and pm.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.projects p
    where p.id = tasks.project_id
      and p.owner_id = auth.uid()
  )
);
