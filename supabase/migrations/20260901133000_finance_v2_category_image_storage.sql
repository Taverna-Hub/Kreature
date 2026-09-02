-- Category artwork is private tenant content. The v2 cutover retains the
-- bucket, so it must also recreate its authenticated, path-scoped policies.
insert into storage.buckets (id, name, public)
values ('category-images', 'category-images', false)
on conflict (id) do update set public = false;

drop policy if exists finance_v2_category_images_select_own on storage.objects;
drop policy if exists finance_v2_category_images_insert_own on storage.objects;
drop policy if exists finance_v2_category_images_update_own on storage.objects;
drop policy if exists finance_v2_category_images_delete_own on storage.objects;

create policy finance_v2_category_images_select_own
on storage.objects for select to authenticated
using (bucket_id = 'category-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy finance_v2_category_images_insert_own
on storage.objects for insert to authenticated
with check (bucket_id = 'category-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy finance_v2_category_images_update_own
on storage.objects for update to authenticated
using (bucket_id = 'category-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'category-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy finance_v2_category_images_delete_own
on storage.objects for delete to authenticated
using (bucket_id = 'category-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
