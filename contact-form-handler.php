<?php
// Change these to your email and site name
$to = 'firstpentagoncollege01@gmail.com';
$site_name = 'first pentagon college';

// Get POST data
$name = isset($_POST['name']) ? strip_tags($_POST['name']) : '';
$email = isset($_POST['email']) ? strip_tags($_POST['email']) : '';
$subject = isset($_POST['subject']) ? strip_tags($_POST['subject']) : 'Contact Form Submission';
$message = isset($_POST['message']) ? strip_tags($_POST['message']) : '';

// Basic validation
if (!$name || !$email || !$message) {
    http_response_code(400);
    echo 'Please fill in all required fields.';
    exit;
}

// Email content
$email_content = "Name: $name\nEmail: $email\nSubject: $subject\nMessage:\n$message";
$email_headers = "From: $site_name <no-reply@yourdomain.com>\r\nReply-To: $email";

// Send email
if (mail($to, "Contact Form: $subject", $email_content, $email_headers)) {
    echo 'Thank you for contacting us! We will get back to you soon.';
} else {
    http_response_code(500);
    echo 'Sorry, there was a problem sending your message.';
}
?>
