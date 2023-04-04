<?php
// Redirect all requests to the proxy script
header('Location: proxy.php?url=' . urlencode($_GET['url']));
?>