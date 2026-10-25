-- 112_telt_voor_factuur_search_path.sql
-- Security Advisor: "function search_path mutable". De functie gebruikt geen tabellen,
-- dus een lege search_path is veilig en verandert het resultaat niet.
ALTER FUNCTION public.telt_voor_factuur(text, boolean) SET search_path = '';
