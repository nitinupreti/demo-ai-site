package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SiteFooterModel {

    @ValueMapValue @Default(values = "TOTC")
    private String brandName;

    @ValueMapValue @Default(values = "Virtual Class for Zoom")
    private String tagline;

    @ValueMapValue @Default(values = "Subscribe to get our Newsletter")
    private String newsletterTitle;

    @ValueMapValue @Default(values = "Your Email")
    private String emailPlaceholder;

    @ValueMapValue @Default(values = "Subscribe")
    private String submitLabel;

    @ValueMapValue @Default(values = "© 2021 Class Technologies Inc.")
    private String copyright;

    @ChildResource
    private List<FooterLinkModel> links;

    private List<FooterLinkModel> filteredLinks;

    @PostConstruct
    void init() {
        filteredLinks = new ArrayList<>();
        if (links != null) {
            for (FooterLinkModel link : links) {
                if (link != null && link.isHasContent()) {
                    filteredLinks.add(link);
                }
            }
        }
    }

    public String getBrandName() { return brandName; }
    public String getTagline() { return tagline; }
    public String getNewsletterTitle() { return newsletterTitle; }
    public String getEmailPlaceholder() { return emailPlaceholder; }
    public String getSubmitLabel() { return submitLabel; }
    public String getCopyright() { return copyright; }
    public List<FooterLinkModel> getLinks() { return Collections.unmodifiableList(filteredLinks); }
    public boolean isHasContent() { return brandName != null && !brandName.isEmpty(); }
}