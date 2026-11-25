begin;

-- Integer FOR loops declare and scope their own counter in PL/pgSQL.
create or replace function private.chat_decrypt_text(p_context text, p_ciphertext text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[];
  version_value integer;
  plaintext text;
  prefix text;
  encoded text;
  expected_tag bytea;
  provided_tag bytea;
  mismatch integer := 0;
begin
  if p_context is null or length(p_context) not between 1 and 500 or p_ciphertext is null then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  parts := regexp_match(p_ciphertext, '^chat-v([1-9][0-9]*):([0-9a-f]+):([0-9a-f]{64})$');
  if parts is null then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  version_value := parts[1]::integer;
  encoded := parts[2];
  provided_tag := decode(parts[3], 'hex');
  expected_tag := extensions.hmac(
    convert_to('chat-content-auth:v1:' || version_value::text || ':' || p_context || ':' || encoded, 'UTF8'),
    decode(private.chat_key_material(version_value, 'authentication_key'), 'hex'),
    'sha256'
  );
  for index_value in 0..31 loop
    mismatch := mismatch | (get_byte(expected_tag, index_value) # get_byte(provided_tag, index_value));
  end loop;
  if mismatch <> 0 then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  prefix := p_context || chr(31);
  plaintext := extensions.pgp_sym_decrypt(
    decode(encoded, 'hex'),
    private.chat_key_material(version_value, 'encryption_key')
  );
  if left(plaintext, length(prefix)) <> prefix then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  return substr(plaintext, length(prefix) + 1);
exception when others then
  raise exception 'Chat ciphertext unavailable' using errcode = '55000';
end;
$$;

commit;