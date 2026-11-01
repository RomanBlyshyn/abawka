-- Видалення через Storage API спершу шукає об'єкти (select), тож команді потрібне право на читання.
-- Покупці бачать фото за публічними адресами бакета, їм ця політика не потрібна.
create policy "staff read catalog" on storage.objects for select to authenticated
  using (bucket_id = 'catalog' and public.is_staff());
