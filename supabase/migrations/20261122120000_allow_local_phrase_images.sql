alter table phrases drop constraint if exists phrases_image_url_check;
alter table phrases add constraint phrases_image_url_check check (
  image_url is null or (
    length(image_url) <= 4096 and (
      image_url ~ '^https://' or
      image_url ~ '^/api/phrase-images/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.webp$'
    )
  )
);
