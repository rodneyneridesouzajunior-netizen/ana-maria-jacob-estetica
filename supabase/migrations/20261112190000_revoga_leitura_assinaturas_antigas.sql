-- Assinaturas e marcações de protocolos antigos passam a ser lidas somente pelo servidor (service_role).
-- Antes, uma conta logada podia lê-las direto pela API sem o segundo fator (MFA). Nenhuma tela usa esse caminho.
revoke select on table public.protocol_signatures from authenticated;
revoke select on table public.protocol_points from authenticated;
