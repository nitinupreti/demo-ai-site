package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ValueMap;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import com.demo.core.models.ogs.OgsLink;
import com.demo.core.models.ogs.OgsSocial;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsSiteFooterModel {

    private final Resource resource;

    @ValueMapValue
    private String brandTagline;

    @ValueMapValue
    private String quickLinksTitle;

    @ValueMapValue
    private String socialTitle;

    @ValueMapValue
    private String copyrightText;

    public OgsSiteFooterModel(Resource resource) {
        this.resource = resource;
    }

    private List<OgsLink> quickLinks;
    private List<OgsSocial> socials;
    private List<OgsLink> legalLinks;

    @PostConstruct
    protected void init() {
        quickLinks = collectLinks("quickLinks");
        legalLinks = collectLinks("legalLinks");
        socials = collectSocials();
    }

    private List<OgsLink> collectLinks(String child) {
        List<OgsLink> collected = new ArrayList<>();
        Resource root = resource.getChild(child);
        if (root != null) {
            for (Resource c : root.getChildren()) {
                ValueMap vm = c.getValueMap();
                collected.add(new OgsLink(vm.get("label", ""), vm.get("link", (String) null)));
            }
        }
        return collected.isEmpty() ? null : Collections.unmodifiableList(collected);
    }

    private List<OgsSocial> collectSocials() {
        List<OgsSocial> collected = new ArrayList<>();
        Resource root = resource.getChild("socials");
        if (root != null) {
            for (Resource c : root.getChildren()) {
                ValueMap vm = c.getValueMap();
                collected.add(new OgsSocial(
                    vm.get("label", ""),
                    vm.get("icon", (String) null),
                    vm.get("link", (String) null)
                ));
            }
        }
        return collected.isEmpty() ? null : Collections.unmodifiableList(collected);
    }

    public String getBrandTagline() {
        return brandTagline;
    }

    public String getQuickLinksTitle() {
        return quickLinksTitle;
    }

    public List<OgsLink> getQuickLinks() {
        return quickLinks;
    }

    public String getSocialTitle() {
        return socialTitle;
    }

    public List<OgsSocial> getSocials() {
        return socials;
    }

    public String getCopyrightText() {
        return copyrightText;
    }

    public List<OgsLink> getLegalLinks() {
        return legalLinks;
    }
}
