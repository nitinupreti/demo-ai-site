package com.demo.core.models.totc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class NewsletterFooterModel {

    @ValueMapValue @Default(values = "Subscribe to get our Newsletter") private String newsletterTitle;
    @ValueMapValue @Default(values = "Your Email") private String emailPlaceholder;
    @ValueMapValue @Default(values = "Subscribe") private String ctaLabel;
    @ValueMapValue @Default(values = "TOTC") private String logoText;
    @ValueMapValue @Default(values = "Virtual Class for Zoom") private String tagline;
    @ValueMapValue @Default(values = "© 2021 Class Technologies Inc.") private String copyright;

    @ChildResource
    private List<FooterLink> footerLinks;

    @PostConstruct
    protected void init() {
        if (footerLinks == null) {
            footerLinks = Collections.emptyList();
        } else {
            List<FooterLink> filtered = new ArrayList<>();
            for (FooterLink f : footerLinks) {
                if (f != null && f.hasContent()) {
                    filtered.add(f);
                }
            }
            footerLinks = Collections.unmodifiableList(filtered);
        }
    }

    public String getNewsletterTitle() { return newsletterTitle; }
    public String getEmailPlaceholder() { return emailPlaceholder; }
    public String getCtaLabel() { return ctaLabel; }
    public String getLogoText() { return logoText; }
    public String getTagline() { return tagline; }
    public String getCopyright() { return copyright; }
    public List<FooterLink> getFooterLinks() { return footerLinks; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(newsletterTitle)
                || StringUtils.isNotBlank(copyright)
                || !footerLinks.isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class FooterLink {
        @ValueMapValue private String label;
        @ValueMapValue private String link;

        public String getLabel() { return label; }
        public String getLink() { return link; }

        public boolean hasContent() { return StringUtils.isNotBlank(label); }
    }
}
